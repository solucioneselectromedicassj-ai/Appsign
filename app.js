// © 2026 Soluciones Electromédicas SJ (Appsign). Todos los derechos reservados. Ver LICENSE.
import { T, FRAME_LEN, HAND_LEN, Segmenter, resample, prepare, rank, mirrorFrame, anyPresent, presentSlot, normWord, autoThreshold, suggestPhrase, Spotter } from './core.js';
import { CONFIG } from './config.js';

// ---------- Configuración ----------
// El motor de reconocimiento (MediaPipe 0.10.14) y los modelos viven en la carpeta mp/ de este mismo sitio: la app no carga código de terceros.

const HAND_CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const COLORS = ['#38bdf8', '#fb923c'];

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Ajustes ----------
const defaults = { thr: 0.25, auto: true, lefty: false, speak: false, cvSize: 32, cvFlip: false, facing: 'environment', fs: 1, theme: 'auto', accent: 'marea', help: false, cue: true, guide: true, face: false };
let S = { ...defaults };
try { S = { ...defaults, ...JSON.parse(localStorage.getItem('lsa-settings') || '{}') }; } catch (e) { /* sin storage */ }
if (!S.v) { S.cvFlip = false; S.v = 2; }
if (S.v < 3) { if (S.accent === 'blue') S.accent = 'marea'; S.v = 3; }
const saveS = () => { try { localStorage.setItem('lsa-settings', JSON.stringify(S)); } catch (e) { /* ignorar */ } };

// ---------- Biblioteca (solo lo que viene en library.json, publicado por el equipo) ----------
let lib = [], libMeta = { version: '', words: 0, validated: true, threshold: 0 }, phrases = [], wanted = [];
const libOf = () => lib;
let thrMemo = null;
function threshold() {
  if (!S.auto) return S.thr;
  if (libMeta.threshold) return libMeta.threshold; // umbral fijado por el equipo en library.json
  if (thrMemo == null) thrMemo = autoThreshold(lib, S.thr);
  return thrMemo;
}
const validSample = s => s && typeof s.word === 'string' && Array.isArray(s.frames) && s.frames.length === T && s.frames.every(fr => Array.isArray(fr) && fr.length === FRAME_LEN);

async function loadLibrary() {
  try {
    const r = await fetch('library.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d.format !== 'appsign-library-v1' || !Array.isArray(d.samples)) throw new Error('formato no reconocido');
    const k = d.scale || 1000;
    lib = d.samples.filter(validSample).map((s, i) => ({ id: i, word: normWord(s.word), feat: prepare(s.frames.map(fr => Float32Array.from(fr, v => v / k))), raw: s.frames.map(fr => fr.map(v => v / k)) })).filter(s => s.word);
    libMeta = { version: String(d.version || ''), words: new Set(lib.map(s => s.word)).size, validated: d.validated !== false, threshold: Number(d.threshold) > 0 ? Number(d.threshold) : 0 };
    phrases = (Array.isArray(d.phrases) ? d.phrases : []).map(p => ({ signs: (p.signs || []).map(normWord).filter(Boolean), text: String(p.text || '').trim() })).filter(p => p.signs.length >= 2 && p.text);
    wanted = (Array.isArray(d.wanted) ? d.wanted : []).map(w => ({ word: normWord(w.word), have: Math.max(0, +w.have || 0), goal: Math.max(1, +w.goal || 5) })).filter(w => w.word);
  } catch (e) { lib = []; phrases = []; wanted = []; libMeta = { version: '', words: 0, validated: true }; console.warn('library.json:', e.message); }
  thrMemo = null; syncSpotter();
  announceUpdate();
  renderLibInfo();
}

function announceUpdate() {
  const box = $('#news'), words = [...new Set(lib.map(s => s.word))].sort((a, b) => a.localeCompare(b, 'es'));
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem('appsign-lib') || 'null'); } catch (e) { /* sin storage */ }
  const mark = () => { try { localStorage.setItem('appsign-lib', JSON.stringify({ version: libMeta.version, words })); } catch (e) { /* ignorar */ } };
  if (!words.length) { box.style.display = 'none'; return; }
  if (!prev) { mark(); box.style.display = 'none'; return; }
  if (prev.version !== libMeta.version) {
    const nuevas = words.filter(w => !(prev.words || []).includes(w));
    box.innerHTML = `<b>Vocabulario actualizado</b> (versión ${esc(libMeta.version)}): ${nuevas.length ? `${nuevas.length} ${nuevas.length === 1 ? 'palabra nueva' : 'palabras nuevas'} — ${esc(nuevas.slice(0, 12).join(', '))}${nuevas.length > 12 ? '…' : ''}` : 'mejoras en las señas existentes'}.<div class="row"><button id="newsOk">Entendido</button></div>`;
    box.style.display = '';
    $('#newsOk').onclick = () => { mark(); box.style.display = 'none'; };
  } else box.style.display = 'none';
}
function renderWanted() {
  const card = $('#wantedCard'); if (!card) return;
  const dl = $('#wordList'); if (dl && wanted.length) dl.innerHTML = wanted.filter(w => w.have < w.goal).map(w => `<option value="${esc(w.word)}">`).join('');
  if ($('#cWord')) collabUpdate();
  card.hidden = !wanted.length;
  $('#wantedList').innerHTML = wanted.map(w => `<button class="want ${w.have >= w.goal ? 'done' : ''}" data-w="${esc(w.word)}" ${w.have >= w.goal ? 'disabled' : ''}>${esc(w.word)} <span>${w.have >= w.goal ? '✓' : w.have + '/' + w.goal}</span></button>`).join('');
}
$('#wantedList').addEventListener('click', e => { const b = e.target.closest('button[data-w]'); if (!b) return; $('#cWord').value = b.dataset.w; collabUpdate(); $('#cWord').scrollIntoView({ behavior: 'smooth', block: 'center' }); });

function renderLibInfo() {
  renderWanted();
  $('#testBanner').style.display = lib.length && !libMeta.validated ? '' : 'none';
  const t = lib.length ? `Vocabulario ${/^\d/.test(libMeta.version) ? 'v' : ''}${libMeta.version}: ${libMeta.words} palabras (${lib.length} muestras) · umbral ${threshold().toFixed(3)}${S.auto ? (libMeta.threshold ? ' (fijado por el equipo)' : ' (auto)') : ''}` : 'Todavía no hay vocabulario cargado en esta versión.';
  $('#libInfo').textContent = t; $('#libInfo2').textContent = t;
  $('#verInfo').textContent = `Appsign ${globalThis.APP_VERSION || '?'} · vocabulario ${libMeta.version || '—'}${libMeta.validated ? '' : ' (de prueba)'}`;
  const words = [...new Set(lib.map(s => s.word))].sort((a, b) => a.localeCompare(b, 'es'));
  $('#vocabList').textContent = words.join(' · ') || '—';
  if (!wanted.length) $('#wordList').innerHTML = words.map(w => `<option value="${esc(w)}">`).join('');
}

// ---------- Estado de la UI ----------
let tab = 'translate';
let speakingNow = false;
const stage = $('#stage'), video = $('#video'), overlay = $('#overlay'), octx = overlay.getContext('2d'), stageMsg = $('#stageMsg');
function setStatus(t, cls = '') { const p = $('#status'); p.textContent = t; p.className = 'pill ' + cls; }

// ---------- Modelo y cámara ----------
let landmarker = null, mode = null, stream = null, running = false, mpKit = null;

// Solo archivos propios (carpeta mp/): funcionan sin internet y no se ejecuta código de otros sitios.
const MP_SOURCES = [
  { label: 'archivos propios', mod: './mp/vision_bundle.mjs', wasm: 'mp/wasm', model: 'mp/hand_landmarker.task', face: 'mp/blaze_face_short_range.tflite', flm: 'mp/face_landmarker.task' },
];

// Descarga del reconocedor con barra de progreso (la primera vez son unos 12 a 18 MB; después queda guardado en el celular)
const SIMD_OK = (() => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; } })();
function dlShow(frac, slow) {
  const box = $('#dl'); if (!box) return;
  box.hidden = false;
  $('#dlTxt').textContent = frac == null ? 'Preparando el reconocedor…' : `Descargando el reconocedor… ${Math.min(99, Math.round(frac * 100))} %`;
  $('#dlBar').value = frac == null ? 0 : Math.min(1, frac);
  $('#dlNote').textContent = 'Se baja una sola vez (unos 12 a 18 MB) y después queda guardado en tu celular. Conviene tener Wi-Fi.' + (slow ? ' Tu conexión parece lenta: puede tardar varios minutos.' : '');
}
const dlHide = () => { const b = $('#dl'); if (b) b.hidden = true; };
async function prefetchModel(src) {
  const base = src.wasm.replace(/\/+$/, '') + '/vision_wasm' + (SIMD_OK ? '' : '_nosimd') + '_internal';
  const items = [[src.mod, 136870], [base + '.js', 209826], [base + '.wasm', SIMD_OK ? 9423986 : 9294247], [src.model, 7819105]];
  const total = items.reduce((a, i) => a + i[1], 0); let got = 0, shown = false;
  const c = navigator.connection || {}, slow = !!(c.saveData || /(^|-)2g|3g/.test(c.effectiveType || ''));
  const timer = setTimeout(() => { shown = true; dlShow(got / total, slow); }, 500);   // si ya estaba guardado, ni se nota
  try {
    for (const [url] of items) {
      const r = await fetch(url); if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
      const rd = r.body.getReader();
      for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.length; const f = got / total; if (shown) { dlShow(f, slow); setStatus(`Descargando ${Math.min(99, Math.round(f * 100))} %`); } }
    }
  } catch (e) { /* si falla, la carga normal de abajo informa el paso que falló */ }
  clearTimeout(timer);
}

async function loadModel() {
  if (landmarker) return;
  setStatus('Cargando…');
  const fails = [];
  for (const src of MP_SOURCES) {
    let step = 'motor';
    try {
      await prefetchModel(src);
      const mp = await import(src.mod);
      step = 'wasm';
      const fs = await mp.FilesetResolver.forVisionTasks(src.wasm);
      step = 'modelo';
      const mk = delegate => mp.HandLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: src.model, delegate }, runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5,
      });
      try { landmarker = await mk('GPU'); } catch (e) { landmarker = await mk('CPU'); }
      mpKit = { mp, fs, src };
      dlHide(); setStatus('Reconocedor listo', 'ok');
      return;
    } catch (e) { fails.push(`${src.label} (${step}): ${e.message || e.name}`); }
  }
  dlHide();
  throw new Error('No se pudo cargar el reconocedor. ' + fails.join(' | ') + ' · Revisá tu conexión y volvé a tocar «Activar cámara».');
}

async function stopSource() {
  if (typeof rec !== 'undefined' && rec) stopRecording();
  running = false;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.pause(); video.removeAttribute('src'); video.srcObject = null; video.controls = false;
  mode = null; lastMsg = ''; guideSt.noFace = 0; guideSt.cuts = []; guideSt.okUntil = 0; setGuide('', '');
  octx.clearRect(0, 0, overlay.width, overlay.height);
  spotter.reset(); spellSpotter.reset();
  updateUI();
}

let mirrorView = false;

async function startCamera() {
  await stopSource();
  try {
    await loadModel();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: S.facing }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  } catch (e) {
    setStatus('Error', 'err');
    stageMsg.textContent = 'No se pudo iniciar: ' + (e.message || e.name);
    stage.classList.add('on');
    return;
  }
  // Se espeja solo la cámara frontal (como un espejo); la trasera se ve tal cual.
  const got = stream.getVideoTracks()[0].getSettings().facingMode;
  mirrorView = got ? got === 'user' : S.facing === 'user';
  video.srcObject = stream; mode = 'camera';
  await video.play().catch(() => {});
  startLoop(); updateUI();
}

async function flipCamera() {
  S.facing = S.facing === 'user' ? 'environment' : 'user'; saveS();
  $('#setFacing').value = S.facing;
  if (mode === 'camera') await startCamera();
  else updateUI();
}
$('#btnFlip').onclick = flipCamera;

function startLoop() { if (running) return; running = true; requestAnimationFrame(tick); }

let lastVT = -1, lastTs = 0, lastMsg = '';
function tick() {
  if (!running) return;
  requestAnimationFrame(tick);
  if (!landmarker || video.readyState < 2 || video.paused || video.ended) return;
  if (video.currentTime === lastVT) return;
  lastVT = video.currentTime;
  if (overlay.width !== video.videoWidth && video.videoWidth) { overlay.width = video.videoWidth; overlay.height = video.videoHeight; }
  let ts = performance.now(); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts;
  let res;
  try { res = landmarker.detectForVideo(video, ts); } catch (e) { console.warn(e); return; }
  const raw = toFrame(res);
  drawLive(raw);
  guideStep(ts, raw);
  faceStep(ts);
  handleFrame(ts, S.lefty ? mirrorFrame(raw) : raw);
}

function toFrame(res) {
  const f = new Float32Array(FRAME_LEN);
  const lms = res.landmarks || [], hs = res.handednesses || res.handedness || [];
  const used = [false, false];
  lms.forEach((lm, i) => {
    const cat = hs[i] && hs[i][0] && hs[i][0].categoryName;
    let slot = cat === 'Left' ? 0 : 1;
    if (used[slot]) slot = 1 - slot;
    if (used[slot]) return;
    used[slot] = true;
    for (let p = 0; p < 21; p++) {
      f[slot * HAND_LEN + p * 3] = lm[p].x; f[slot * HAND_LEN + p * 3 + 1] = lm[p].y; f[slot * HAND_LEN + p * 3 + 2] = lm[p].z;
    }
  });
  return f;
}

function drawLive(raw) {
  const w = overlay.width, h = overlay.height;
  octx.clearRect(0, 0, w, h);
  for (let slot = 0; slot < 2; slot++) {
    if (!presentSlot(raw, slot)) continue;
    const b = slot * HAND_LEN;
    octx.strokeStyle = COLORS[slot]; octx.fillStyle = COLORS[slot]; octx.lineWidth = Math.max(2, w / 240);
    octx.beginPath();
    for (const [a, c] of HAND_CONN) { octx.moveTo(raw[b + a * 3] * w, raw[b + a * 3 + 1] * h); octx.lineTo(raw[b + c * 3] * w, raw[b + c * 3 + 1] * h); }
    octx.stroke();
    for (let p = 0; p < 21; p++) { octx.beginPath(); octx.arc(raw[b + p * 3] * w, raw[b + p * 3 + 1] * h, Math.max(2, w / 200), 0, 6.3); octx.fill(); }
  }
}

let holdUntil = 0;
function setStageMsg(t, hold = 0) {
  if (hold) holdUntil = Date.now() + hold; else if (Date.now() < holdUntil) return;
  if (t !== lastMsg) { lastMsg = t; stageMsg.textContent = t; }
}

// Avisos para quien sostiene el celular: vibración y sonido suave (así no hace falta mirar la pantalla)
let audioCtx = null;
function cue(kind) {
  if (!S.cue) return;
  try { if (navigator.vibrate) navigator.vibrate(kind === 'doubt' ? [60, 90, 60] : kind === 'warn' ? [200] : [50]); } catch (e) { /* sin vibración */ }
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = kind === 'ok' ? 880 : kind === 'doubt' ? 560 : 330; g.gain.value = 0.06;
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.09);
  } catch (e) { /* sin audio */ }
}
// Cómo le fue a esa seña: devuelve un consejo para pedirle a la persona que seña, o null si estuvo bien
function coachFor(res) {
  const ratio = res.frames.length ? res.frames.filter(anyPresent).length / res.frames.length : 0;
  if (!res.ok) return 'Muy corta o muy rápida: pedile que la haga más lento';
  if (res.dur > 4500) return 'Muy larga: pedile una sola seña y que baje las manos';
  if (ratio < 0.6) return 'No veo bien las manos: más luz o más cerca';
  return null;
}
// Compara contra el vocabulario y dice si hay duda (no alcanza el parecido, o dos palabras casi empatan)
function judgeRanks(ranks) {
  const thr = threshold();
  const accepted = ranks[0].dist <= thr;
  const margin = ranks[1] ? ranks[1].dist - ranks[0].dist : 1;
  return { ranks, thr, accepted, doubt: !accepted || margin < 0.03 };
}

// ---------- Ayuda de encuadre: avisa a quien sostiene el celular cómo acomodarlo ----------
// Rangos tomados de los videos que mejor funcionaron: la cara ocupa entre 0,16 y 0,34 del ancho y queda en el tercio de arriba.
let faceDet = null, faceTs = 0, faceN = 0, faceTry = false;
const guideSt = { noFace: 0, cuts: [], okUntil: 0, last: '' };
async function ensureFaceDet() {
  if (faceDet || faceTry || !mpKit || !mpKit.mp.FaceDetector) return;
  faceTry = true;
  try { faceDet = await mpKit.mp.FaceDetector.createFromOptions(mpKit.fs, { baseOptions: { modelAssetPath: mpKit.src.face, delegate: 'CPU' }, runningMode: 'VIDEO', minDetectionConfidence: 0.5 }); } catch (e) { console.warn('detector de cara:', e.message); }
}
function setGuide(txt, kind) {
  const el = $('#guide'); if (guideSt.last === txt + kind) return; guideSt.last = txt + kind;
  el.textContent = txt; el.dataset.kind = kind || ''; el.style.display = txt ? '' : 'none';
}
function guideStep(ts, raw) {
  if (!S.guide || !(tab === 'translate' || (tab === 'converse' && cvCam))) { setGuide('', ''); return; }
  for (let slot = 0; slot < 2; slot++) {
    if (!presentSlot(raw, slot)) continue;
    let out = 0; const b = slot * HAND_LEN;
    for (let p = 0; p < 21; p++) { const x = raw[b + p * 3], y = raw[b + p * 3 + 1]; if (x < 0.01 || x > 0.99 || y < 0.01 || y > 0.99) out++; }
    guideSt.cuts.push({ t: ts, cut: out >= 3 });
  }
  while (guideSt.cuts.length && guideSt.cuts[0].t < ts - 3000) guideSt.cuts.shift();
  if (++faceN % 6) return;
  ensureFaceDet();
  let fw = null, ny = null;
  if (faceDet && video.videoWidth) {
    try {
      faceTs = Math.max(faceTs + 1, ts);
      const d = (faceDet.detectForVideo(video, faceTs).detections || [])[0];
      if (d) { fw = d.boundingBox.width / video.videoWidth; const kp = d.keypoints && d.keypoints[2]; ny = kp ? kp.y : (d.boundingBox.originY + d.boundingBox.height * 0.55) / video.videoHeight; }
    } catch (e) { /* sin detección */ }
  }
  const cutRatio = guideSt.cuts.length >= 8 ? guideSt.cuts.filter(c => c.cut).length / guideSt.cuts.length : 0;
  let msg = '';
  if (fw == null) { if (!guideSt.noFace) guideSt.noFace = ts; if (faceDet && ts - guideSt.noFace > 1500) msg = 'Encuadrá a la persona de la cabeza a la cintura'; }
  else guideSt.noFace = 0;
  if (fw != null) {
    if (fw < 0.16) msg = 'Acercate un poco';
    else if (fw > 0.34) msg = 'Alejate un poco';
    else if (ny > 0.5) msg = 'Inclinalo hacia abajo: la cara tiene que quedar arriba';
    else if (ny < 0.1) msg = 'Inclinalo hacia arriba';
  }
  if (!msg && cutRatio > 0.3) msg = 'Alejate o dejá más lugar: las manos se salen del cuadro';
  if (msg) { setGuide(msg, 'warn'); guideSt.okUntil = 0; }
  else if (fw != null) { if (!guideSt.okUntil) guideSt.okUntil = ts + 2500; setGuide(ts < guideSt.okUntil ? 'Buen encuadre ✓' : '', 'ok'); }
}

// ---------- Segmentación y consumidores ----------
// Lectura continua: reconoce las señas aunque vayan seguidas o haya una mano apoyada en el cuadro
const spotter = new Spotter();
const spellSpotter = new Spotter();
const isLetter = w => /^[a-zñ]$/.test(w);
function syncSpotter() { spotter.setLibrary(lib, threshold()); spellSpotter.setLibrary(lib.filter(s => isLetter(s.word)), threshold()); }

function handleFrame(ts, frame) {
  const has = anyPresent(frame);
  if (!(tab === 'translate' || (tab === 'converse' && cvCam))) return;
  if (spellOn && tab === 'translate') {
    const sev = spellSpotter.push(ts, frame);
    setStageMsg(has ? 'Leyendo la letra…' : 'Deletreando: una letra por vez, bajando las manos');
    for (const e of sev) onSpellEvent(e);
    return;
  }
  const evs = spotter.push(ts, frame);
  setStageMsg(has ? 'Mirando…' : 'Listo: pedile una seña');
  for (const e of evs) (tab === 'translate' ? onTranslateEvent : onConverseEvent)(e);
}

// ---------- Traducir ----------
const transcript = [];
let last = null;

function onTranslateEvent(e) {
  if (e.kind === 'short') { setStageMsg('Muy corta o muy rápida: pedile que la haga más lento', 3500); cue('warn'); return; }
  if (!lib.length) { last = { ranks: [], accepted: false, note: 'Todavía no hay vocabulario cargado en esta versión de la app.' }; renderLast(); return; }
  const j = judgeRanks(e.ranks);
  transcript.push({ word: j.accepted ? j.ranks[0].word : null, doubt: j.doubt && j.accepted, q: j.accepted && e.kind === 'sign' && browFlag(e.t0, e.t1), cands: j.ranks.slice(0, 3).map(r => r.word) });
  last = { ...j, q16: e.q16, idx: transcript.length - 1 };
  renderTranscript(); renderLast();
  if (j.doubt) { setStageMsg('No estoy seguro/a: mirá abajo y comparalo con la persona', 3500); cue('doubt'); }
  else { setStageMsg('✓ ' + j.ranks[0].word + ' — pedile la próxima', 2500); cue('ok'); }
  if (j.accepted && !j.doubt && S.speak) speak(j.ranks[0].word);
}

// Confirmar o corregir la palabra de la última seña (y, si la persona lo activó, guardar la corrección para el equipo)
function labelLast(word) {
  if (last && last.idx != null) { transcript[last.idx].word = word; transcript[last.idx].doubt = false; transcript[last.idx].cands = [word]; renderTranscript(); }
  if (last) saveCorrection(word, last.q16);
}

function renderTranscript() {
  const el = $('#transcript');
  renderPhrase();
  if (!transcript.length) { el.innerHTML = '<span class="mut">Poné las manos en cuadro, hacé la seña y bajalas.</span>'; return; }
  el.innerHTML = transcript.map((t, i) => `<span class="chip ${t.phrase ? 'phrase' : t.word && !t.doubt ? '' : 'unk'} ${i === transcript.length - 1 ? 'last' : ''}">${t.phrase ? esc(t.phrase) : t.word ? (t.doubt ? '¿' + esc(t.word) + '?' : esc(t.word)) : '¿?'}${t.q ? '<b class="qb" title="La cara marcó pregunta (ceño fruncido)">?</b>' : ''}</span>`).join('');
}

// Prototipo de frases: si las últimas señas encajan con una frase de la lista del equipo, se propone completarla
let phraseSug = null;
function renderPhrase() {
  const box = $('#phraseBox');
  phraseSug = phrases.length ? suggestPhrase(transcript, phrases) : null; // las entradas que ya son frase no tienen candidatas: no se vuelven a proponer
  if (!phraseSug) { box.style.display = 'none'; return; }
  const ph = phraseSug.phrase, full = phraseSug.kind === 'full';
  box.style.display = '';
  box.innerHTML = full
    ? `<div><b>¿Querés decir:</b> «${esc(ph.text)}»?</div><div class="mut">Las señas leídas se parecen a esta frase, aunque alguna no esté segura. Confirmalo con la persona.</div><div class="row"><button class="pri" id="phUse">Usar la frase</button></div>`
    : `<div><b>Parece el comienzo de:</b> «${esc(ph.text)}»</div><div class="mut">Faltan: ${esc(ph.signs.slice(phraseSug.matched).join(' · '))}</div>`;
  const u = $('#phUse'); if (u) u.onclick = () => { transcript.splice(-phraseSug.n, phraseSug.n, { phrase: ph.text, word: null }); if (S.speak) speak(ph.text); renderTranscript(); };
}

function renderLast() {
  const card = $('#lastCard');
  if (!last) { card.style.display = 'none'; return; }
  card.style.display = '';
  const info = $('#lastInfo'), act = $('#lastActions');
  act.innerHTML = '';
  if (last.note) { info.textContent = last.note; return; }
  const top = last.ranks[0];
  info.innerHTML = !last.doubt ? `Reconocida: <b>${esc(top.word)}</b>`
    : last.accepted ? `Creo que es <b>${esc(top.word)}</b>, pero no estoy seguro/a.` : 'No la reconozco bien. ¿Es alguna de estas?';
  last.ranks.slice(0, 3).forEach(r => {
    const b = document.createElement('button');
    b.textContent = 'Era: ' + r.word;
    b.onclick = () => labelLast(r.word);
    act.appendChild(b);
  });
  if (last.doubt) {
    const c = document.createElement('button'); c.className = 'pri'; c.textContent = 'Mostrarle a la persona sorda';
    c.onclick = () => openCompare(last.ranks.slice(0, 3), labelLast);
    act.insertBefore(c, act.firstChild);
  }
  const o = document.createElement('button'); o.textContent = 'Era otra palabra…';
  o.onclick = () => { const w = prompt('¿Qué palabra era?'); if (w && normWord(w)) labelLast(w); };
  act.appendChild(o);
  const t = document.createElement('button');
  t.textContent = 'Es una seña nueva: enviarla al equipo';
  t.onclick = () => showTab('collab');
  act.appendChild(t);
}

// ---------- Comparar con la persona sorda: se muestra la seña del vocabulario y ella dice si es esa ----------
const cmp = { cands: [], i: 0, pick: null, timer: 0 };
function sampleBounds(fr) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  fr.forEach(f => [0, 1].forEach(sl => { if (!presentSlot(f, sl)) return; for (let p = 0; p < 21; p++) { const x = f[sl * HAND_LEN + p * 3], y = f[sl * HAND_LEN + p * 3 + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
  return { x0, y0, w: Math.max(0.05, x1 - x0), h: Math.max(0.05, y1 - y0) };
}
function drawCmpFrame(fr, bd, cv = $('#cmpCv')) {
  const g = cv.getContext('2d'), W = cv.width, sc = 0.82 * W / Math.max(bd.w, bd.h);
  g.clearRect(0, 0, W, W);
  const X = x => W / 2 + (x - bd.x0 - bd.w / 2) * sc, Y = y => W / 2 + (y - bd.y0 - bd.h / 2) * sc;
  [0, 1].forEach(sl => {
    if (!presentSlot(fr, sl)) return;
    const b = sl * HAND_LEN; g.strokeStyle = g.fillStyle = COLORS[sl]; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); for (const [a, c] of HAND_CONN) { g.moveTo(X(fr[b + a * 3]), Y(fr[b + a * 3 + 1])); g.lineTo(X(fr[b + c * 3]), Y(fr[b + c * 3 + 1])); } g.stroke();
    for (let p = 0; p < 21; p++) { g.beginPath(); g.arc(X(fr[b + p * 3]), Y(fr[b + p * 3 + 1]), 5, 0, 6.3); g.fill(); }
  });
}
function showCandidate() {
  const c = cmp.cands[cmp.i], raw = lib[c.id].raw.map(f => Float32Array.from(f)), bd = sampleBounds(raw);
  $('#cmpWord').textContent = c.word; $('#cmpNo').style.display = cmp.cands.length > 1 ? '' : 'none';
  clearInterval(cmp.timer); let k = 0; drawCmpFrame(raw[0], bd);
  cmp.timer = setInterval(() => { k = (k + 1) % raw.length; drawCmpFrame(raw[k], bd); }, 140);
}
function openCompare(ranks, pick) {
  const seen = new Set(); cmp.cands = ranks.filter(r => !seen.has(r.word) && seen.add(r.word)); cmp.i = 0; cmp.pick = pick;
  $('#cmp').hidden = false; showCandidate(); $('#cmpYes').focus();
}
function closeCompare() { clearInterval(cmp.timer); $('#cmp').hidden = true; }
$('#cmpYes').onclick = () => { const w = cmp.cands[cmp.i].word; closeCompare(); cmp.pick(w); };
$('#cmpNo').onclick = () => { cmp.i = (cmp.i + 1) % cmp.cands.length; showCandidate(); };
$('#cmpOther').onclick = () => { const w = prompt('¿Qué palabra era?'); if (w && normWord(w)) { closeCompare(); cmp.pick(w); } };
$('#cmpClose').onclick = closeCompare;

// ---------- Correcciones para mandar al equipo (solo puntos de manos; nunca entran solas al vocabulario) ----------
const CORR_KEY = 'appsign-corr';
const corrGet = () => { try { return JSON.parse(localStorage.getItem(CORR_KEY) || '[]'); } catch (e) { return []; } };
const corrSet = a => { try { localStorage.setItem(CORR_KEY, JSON.stringify(a)); } catch (e) { /* sin storage */ } };
function saveCorrection(word, q16) {
  const w = normWord(word); if (!S.help || !w || !q16) return;
  const a = corrGet(); a.push({ id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), word: w, f: q16.map(fr => fr.map(v => Math.round(v * 1000))), t: Date.now() });
  corrSet(a.slice(-300)); corrUI();
}
function corrUI() {
  const n = corrGet().length;
  $('#corrCount').textContent = n ? `Tenés ${n} ${n === 1 ? 'seña guardada' : 'señas guardadas'} para mandar al equipo.` : 'Todavía no hay señas guardadas.';
  $('#corrSend').disabled = !n; $('#corrOff').style.display = S.help ? 'none' : '';
}
$('#corrSend').onclick = async () => {
  const a = corrGet(); if (!a.length) return;
  const data = { format: 'lsa-landmarks-v1', frames: T, exported: new Date().toISOString(), samples: a.map(c => ({ id: c.id, word: c.word, status: 'pending', frames: c.f.map(fr => fr.map(v => v / 1000)), created: c.t, source: 'app pública: seña corregida por el usuario', contributor: '', region: '' })) };
  const f = new File([JSON.stringify(data)], `appsign-correcciones-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  const text = `Appsign: ${a.length} señas corregidas (solo puntos de las manos, sin video).`;
  let sent = false;
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], title: 'Appsign: correcciones', text }); sent = true; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (!sent) {
    const l = document.createElement('a'); l.href = URL.createObjectURL(f); l.download = f.name; l.click(); setTimeout(() => URL.revokeObjectURL(l.href), 3000);
    if (CONFIG.email) location.href = `mailto:${CONFIG.email}?subject=${encodeURIComponent('Appsign: correcciones')}&body=${encodeURIComponent(text + '\n\n(Adjuntá el archivo descargado)')}`;
  }
  if (confirm('¿Ya lo mandaste? Si querés, borro las señas guardadas de este celular.')) { corrSet([]); corrUI(); }
};

$('#btnClear').onclick = () => { transcript.length = 0; last = null; renderTranscript(); renderLast(); };
$('#btnSpeak').onclick = () => speak(transcript.map(t => t.phrase || (t.doubt ? '' : t.word)).filter(Boolean).join(' '));
function speak(text) {
  if (!text || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text); u.lang = 'es-AR';
  u.onstart = () => { speakingNow = true; };
  u.onend = u.onerror = () => setTimeout(() => { speakingNow = false; }, 500);
  speakingNow = true;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

// ---------- Colaborar (el aporte NO entra a la app: va al equipo para validarlo) ----------
const C = { file: null, url: '' };
// Cupo por palabra: si el equipo publicó una lista de «palabras que buscamos», solo se aceptan esas y mientras no estén completas.
function wordStatus() {
  const w = normWord($('#cWord').value); if (!w) return { w, state: 'empty' };
  const hit = wanted.find(x => x.word === w);
  if (hit) return hit.have >= hit.goal ? { w, state: 'full', hit } : { w, state: 'ok', hit };
  if (lib.some(s => s.word === w)) return { w, state: 'have' };           // ya está en el vocabulario aprobado
  return wanted.length ? { w, state: 'notwanted' } : { w, state: 'ok' };   // sin lista publicada: se acepta cualquiera (como antes)
}
function collabUpdate() {
  const acctOk = !AUTH_OK || !!(ses && profile);
  $('#cNeedAcct').hidden = acctOk;
  const st = wordStatus(), m = $('#cWordMsg');
  const txt = { full: `«${st.w}» ya tiene todos los aportes que necesitamos. ¡Gracias! Probá con otra palabra de la lista.`, have: `«${st.w}» ya está en el vocabulario. Probá con una de «Palabras que buscamos».`, notwanted: `«${st.w}» no está en la lista de palabras que buscamos ahora. Podés proponerla en «Sugerencias y errores» (Ajustes).`, ok: st.hit ? `Faltan ${st.hit.goal - st.hit.have} aporte${st.hit.goal - st.hit.have === 1 ? '' : 's'} de «${st.w}». ¡Gracias por sumar!` : '', empty: '' }[st.state];
  m.textContent = txt; m.dataset.kind = st.state;
  $('#cSend').disabled = !(C.file && st.w && st.state === 'ok' && $('#cConsent').checked && acctOk);
}
function pickFile(f) {
  if (C.url) URL.revokeObjectURL(C.url);
  C.file = f || null; C.url = f ? URL.createObjectURL(f) : '';
  const p = $('#cPrev');
  if (!f) { p.innerHTML = ''; collabUpdate(); return; }
  const mb = (f.size / 1048576).toFixed(1);
  p.innerHTML = (f.type.startsWith('image/') ? `<img src="${C.url}" style="max-width:100%;max-height:260px;border-radius:10px">` : `<video src="${C.url}" controls playsinline muted style="max-width:100%;max-height:260px;border-radius:10px"></video>`)
    + `<div class="mut">${esc(f.name)} · ${mb} MB${f.size > 30 * 1048576 ? ' — es pesado: probá con un video más corto' : ''}</div>`;
  collabUpdate();
}
$('#cVideo').onchange = e => { pickFile(e.target.files[0]); e.target.value = ''; };
$('#cPhoto').onchange = e => { pickFile(e.target.files[0]); e.target.value = ''; };
['#cWord', '#cConsent'].forEach(s => $(s).addEventListener('input', collabUpdate));
$('#cConsent').addEventListener('change', collabUpdate);
$('#cContactInfo').textContent = CONFIG.email
  ? `Se envía por correo a ${CONFIG.equipo} (${CONFIG.email}) con el título de la palabra. El equipo descarga el video, lo procesa y borra el correo.`
  : 'Al enviar se abre el menú del celular para elegir el correo del equipo.';
$('#cSend').onclick = async () => {
  const f0 = C.file, w = normWord($('#cWord').value);
  if (!f0 || !w || !$('#cConsent').checked) return;
  const ext = (f0.name.split('.').pop() || (f0.type.startsWith('image/') ? 'jpg' : 'mp4')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  const f = new File([f0], `appsign-${w.replace(/[^\p{L}\p{N}]+/gu, '_')}.${ext}`, { type: f0.type });
  const text = ['Aporte para Appsign', 'Palabra: ' + w, 'Región: ' + ($('#cRegion').value.trim() || '—'), 'Contacto: ' + ($('#cContact').value.trim() || '—'),
    ses && profile ? `ID de colaborador: ${ses.user.id} (${profile.rol}, ${profile.pais})` : '',
    'Acepto que el equipo vea este archivo para validar la seña y usarla solo para el vocabulario. El equipo lo descarga, lo procesa en una computadora y borra este correo.'].filter(Boolean).join('\n');
  $('#cMsg').textContent = '';
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], title: w, text }); $('#cMsg').textContent = '¡Gracias! Si elegiste el correo del equipo, lo va a revisar.'; return; }
    catch (e) { if (e && e.name === 'AbortError') { $('#cMsg').textContent = 'Envío cancelado.'; return; } }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  if (CONFIG.email) location.href = `mailto:${CONFIG.email}?subject=${encodeURIComponent(w)}&body=${encodeURIComponent(text + '\n\n(Adjuntá el archivo descargado)')}`;
  $('#cMsg').textContent = CONFIG.email ? 'Se descargó el archivo. Adjuntalo al correo que se abre para mandarlo al equipo.' : 'Se descargó el archivo. Mandalo al equipo por correo.';
};

// ---------- Apariencia (tamaño de letra, fondo y color) ----------
function applyLook() {
  const h = document.documentElement;
  h.style.setProperty('--fs', S.fs);
  if (S.theme === 'auto') delete h.dataset.theme; else h.dataset.theme = S.theme;
  if (S.accent === 'marea') delete h.dataset.accent; else h.dataset.accent = S.accent;
  document.querySelectorAll('[data-fs]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.fs === +S.fs)));
  document.querySelectorAll('button[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === S.theme)));
  document.querySelectorAll('button[data-accent]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.accent === S.accent)));
}
document.querySelectorAll('[data-fs]').forEach(b => b.onclick = () => { S.fs = +b.dataset.fs; saveS(); applyLook(); });
document.querySelectorAll('button[data-theme]').forEach(b => b.onclick = () => { S.theme = b.dataset.theme; saveS(); applyLook(); });
document.querySelectorAll('button[data-accent]').forEach(b => b.onclick = () => { S.accent = b.dataset.accent; saveS(); applyLook(); });

// ---------- Ajustes ----------
function loadSettingsUI() {
  applyLook(); $('#setFace').checked = S.face; $('#setGuide').checked = S.guide; $('#setHelp').checked = S.help; $('#setCue').checked = S.cue; corrUI();
  $('#setFacing').value = S.facing; $('#setAuto').checked = S.auto; $('#setThr').value = S.thr; $('#setLefty').checked = S.lefty; $('#setSpeak').checked = S.speak;
  updateThrLabel();
}
function updateThrLabel() { $('#thrVal').textContent = S.auto ? 'automática' : S.thr.toFixed(2); $('#setThr').disabled = S.auto; }
$('#setFacing').onchange = e => { S.facing = e.target.value; saveS(); if (mode === 'camera') startCamera(); else updateUI(); };
$('#setAuto').onchange = e => { S.auto = e.target.checked; saveS(); updateThrLabel(); renderLibInfo(); syncSpotter(); };
$('#setThr').oninput = e => { S.thr = +e.target.value; saveS(); updateThrLabel(); syncSpotter(); };
$('#setFace').onchange = e => { S.face = e.target.checked; saveS(); if (S.face) ensureFlm(); };
$('#setGuide').onchange = e => { S.guide = e.target.checked; saveS(); if (S.guide) ensureFaceDet(); else setGuide('', ''); };
$('#setHelp').onchange = e => { S.help = e.target.checked; saveS(); corrUI(); };
$('#setCue').onchange = e => { S.cue = e.target.checked; saveS(); };
$('#setLefty').onchange = e => { S.lefty = e.target.checked; saveS(); };
$('#setSpeak').onchange = e => { S.speak = e.target.checked; saveS(); };

// ---------- Conversar ----------
// Dos funciones independientes en el mismo celular: señas -> texto (cámara, para quien oye) y voz -> texto (micrófono, para la persona sorda).
let cvCam = false, recog = null, micOn = false;
const voiceLines = [], signLines = []; // signLines: [{t, words:[]}]
let cvLast = null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function cvRender() {
  $('#cvVoiceLog').innerHTML = voiceLines.slice(-6).map(t => `<p class="ln">${esc(t)}</p>`).join('');
  $('#cvSignLog').innerHTML = signLines.slice(-6).map(l => `<p class="ln">${l.words.map(w => w || '¿?').map(esc).join(' ')}</p>`).join('');
  const alt = $('#cvAlt'); alt.innerHTML = '';
  if (cvLast && cvLast.ranks.length) {
    const set = w => { cvLast.line.words[cvLast.idx] = w; saveCorrection(w, cvLast.q16); cvRender(); };
    cvLast.ranks.slice(0, 3).forEach(r => {
      const b = document.createElement('button'); b.textContent = 'Era: ' + r.word;
      b.onclick = () => set(r.word);
      alt.appendChild(b);
    });
    if (cvLast.doubt) {
      const c = document.createElement('button'); c.className = 'pri'; c.textContent = 'Mostrarle a la persona sorda';
      c.onclick = () => openCompare(cvLast.ranks.slice(0, 3), set);
      alt.insertBefore(c, alt.firstChild);
    }
  }
}
function cvApplySettings() {
  $('#tab-converse').style.setProperty('--cvsize', S.cvSize + 'px');
  $('#cvSize').value = S.cvSize;
}
$('#cvSize').oninput = e => { S.cvSize = +e.target.value; saveS(); cvApplySettings(); };

function onConverseEvent(e) {
  if (e.kind === 'short') { setStageMsg('Muy corta o muy rápida: pedile que la haga más lento', 3500); cue('warn'); return; }
  if (!lib.length) { $('#cvCamMsg').textContent = 'Todavía no hay vocabulario cargado en esta versión de la app.'; return; }
  const j = judgeRanks(e.ranks);
  const word = j.accepted ? (j.doubt ? '¿' + j.ranks[0].word + '?' : j.ranks[0].word) : null;
  const now = Date.now();
  let line = signLines[signLines.length - 1];
  if (!line || now - line.t > 4000) { line = { t: now, words: [] }; signLines.push(line); }
  line.t = now; line.words.push(word);
  cvLast = { ranks: j.ranks, doubt: j.doubt, line, idx: line.words.length - 1, q16: e.q16 };
  cvRender();
  if (j.doubt) { setStageMsg('No estoy seguro/a: comparalo con la persona', 3500); cue('doubt'); }
  else { setStageMsg('✓ ' + word + ' — pedile la próxima', 2500); cue('ok'); }
}

function addSpeech(text) { if (text) { voiceLines.push(text); cvRender(); } }
function startMic() {
  if (!SR) { $('#cvMicMsg').textContent = 'Este navegador no trae reconocimiento de voz. Probá con Chrome en Android o en computadora.'; return false; }
  recog = new SR(); recog.lang = 'es-AR'; recog.continuous = true; recog.interimResults = true;
  recog.onresult = e => {
    if (speakingNow) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) addSpeech(r[0].transcript.trim()); else interim += r[0].transcript;
    }
    $('#cvInterim').textContent = interim;
  };
  recog.onend = () => { if (micOn) { try { recog.start(); } catch (e) { /* ya activo */ } } };
  recog.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      micOn = false; $('#micDot').classList.remove('on'); micBtnUI();
      $('#cvMicMsg').textContent = 'Sin permiso para el micrófono. Habilitalo en el navegador para ver lo que dicen.';
    }
  };
  micOn = true;
  try { recog.start(); } catch (e) { micOn = false; return false; }
  $('#micDot').classList.add('on');
  return true;
}
function stopMic() { micOn = false; try { recog && recog.stop(); } catch (e) { /* nada */ } $('#micDot').classList.remove('on'); $('#cvInterim').textContent = ''; micBtnUI(); }
function micBtnUI() {
  $('#cvMicBtn').lastChild.textContent = micOn ? 'Apagar micrófono' : 'Activar micrófono';
  $('#cvMicBtn').className = micOn ? 'wide' : 'pri wide';
  if (micOn) $('#cvMicMsg').textContent = 'Escuchando… lo que digan aparece acá.';
}
function camBtnUI() {
  $('#cvCamBtn').textContent = cvCam ? 'Apagar cámara' : 'Activar cámara';
  $('#cvCamBtn').className = cvCam ? 'wide' : 'pri wide';
}
function converseStop() {
  if (cvCam) { cvCam = false; camBtnUI(); }
  if (micOn) stopMic();
}
$('#cvCamBtn').onclick = async () => {
  if (cvCam) { cvCam = false; await stopSource(); camBtnUI(); $('#cvCamMsg').textContent = ''; return; }
  cvCam = true; camBtnUI(); $('#cvCamMsg').textContent = 'Mirando… poné las manos de la persona en cuadro y bajalas entre una seña y otra.';
  await startCamera();
  if (mode !== 'camera') { cvCam = false; camBtnUI(); }
};
$('#cvMicBtn').onclick = () => { if (micOn) stopMic(); else { if (startMic()) micBtnUI(); } };
$('#cvClear').onclick = () => { voiceLines.length = 0; signLines.length = 0; cvLast = null; cvRender(); };

// ---------- Grabar video con subtítulos para compartir ----------
// Se dibuja cámara + subtítulos en un canvas y se graba ese canvas. Nada se sube: se comparte desde el celular.
let rec = null;
const REC_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

function subtitleLines() {
  if (tab === 'converse') {
    const v = voiceLines[voiceLines.length - 1] || '';
    const sl = signLines[signLines.length - 1];
    return [sl ? sl.words.map(w => w || '¿?').join(' ') : '', v].filter(Boolean);
  }
  return [transcript.slice(-8).map(t => t.phrase || (t.word ? (t.doubt ? '¿' + t.word + '?' : t.word + (t.q ? ' ?' : '')) : '¿?')).join(' ')].filter(Boolean);
}

function wrapText(ctx, text, maxW) {
  const out = []; let line = '';
  for (const w of text.split(' ')) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

function drawRecFrame(r) {
  const { ctx, cv } = r, w = cv.width, h = cv.height;
  ctx.save();
  if (mirrorView) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();
  const lines = subtitleLines();
  if (!lines.length) return;
  const fs = Math.round(h / 14);
  ctx.font = `700 ${fs}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round'; ctx.lineWidth = fs / 5; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
  const rows = lines.flatMap(l => wrapText(ctx, l, w * 0.92)).slice(-3);
  let y = h - fs * 0.5;
  for (let i = rows.length - 1; i >= 0; i--) { ctx.strokeText(rows[i], w / 2, y); ctx.fillText(rows[i], w / 2, y); y -= fs * 1.2; }
}

function startRecording() {
  if (!mode || !window.MediaRecorder || !video.videoWidth) { setStageMsg('Activá la cámara para grabar'); return; }
  if (!confirm('Vas a grabar un video con subtítulos.\n\nAntes de grabar, asegurate de que la persona que aparece sabe y está de acuerdo en que la filmes y en que el video se pueda compartir.\n\n¿Empezar a grabar?')) return;
  const type = REC_TYPES.find(t => MediaRecorder.isTypeSupported(t));
  if (!type) { setStageMsg('Este navegador no puede grabar video'); return; }
  const cv = document.createElement('canvas'); cv.width = video.videoWidth; cv.height = video.videoHeight;
  const r = { cv, ctx: cv.getContext('2d'), chunks: [], t0: Date.now(), type, raf: 0, timer: 0 };
  const loop = () => { drawRecFrame(r); r.raf = requestAnimationFrame(loop); };
  loop();
  r.mr = new MediaRecorder(cv.captureStream(30), { mimeType: type, videoBitsPerSecond: 2_500_000 });
  r.mr.ondataavailable = e => { if (e.data && e.data.size) r.chunks.push(e.data); };
  r.mr.onstop = () => { cancelAnimationFrame(r.raf); clearInterval(r.timer); finishRecording(r); };
  r.mr.start(1000);
  r.timer = setInterval(() => {
    const s = Math.floor((Date.now() - r.t0) / 1000);
    $('#recTime').textContent = `● REC ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= 120) stopRecording(); // tope de 2 minutos
  }, 500);
  rec = r;
  $('#btnRec').classList.add('on'); stage.classList.add('recording');
}

function stopRecording() {
  if (!rec) return;
  const r = rec; rec = null;
  $('#btnRec').classList.remove('on'); stage.classList.remove('recording');
  try { r.mr.stop(); } catch (e) { cancelAnimationFrame(r.raf); clearInterval(r.timer); }
}

async function finishRecording(r) {
  if (!r.chunks.length) return;
  const ext = r.type.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([new Blob(r.chunks, { type: r.type.split(';')[0] })], `appsign-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.${ext}`, { type: r.type.split(';')[0] });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Video con Appsign' }); setStageMsg('Video compartido'); return; }
    catch (e) { if (e && e.name === 'AbortError') { setStageMsg('Envío cancelado (el video no se guardó)'); return; } }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  setStageMsg('Video descargado');
}
$('#btnRec').onclick = () => (rec ? stopRecording() : startRecording());

// ---------- Modo deletreo (nombres propios): las letras quietas se juntan en una palabra ----------
let spellOn = false; const spell = [];
const spellText = () => spell.map(l => l.ch).join('');
function renderSpell() {
  const w = $('#spellWord');
  w.innerHTML = spell.length ? spell.map(l => l.ch === ' ' ? '<span class="sp"></span>' : `<span class="ltr ${l.doubt ? 'unk' : ''}">${esc(l.ch.toUpperCase())}</span>`).join('') : '<span class="mut">Hacé la primera letra…</span>';
  const alt = $('#spellAlt'); alt.innerHTML = '';
  const last = spell[spell.length - 1];
  if (last && last.cands && last.cands.length > 1) {
    const l = document.createElement('span'); l.className = 'mut'; l.textContent = 'Última letra:'; alt.appendChild(l);
    last.cands.forEach(c => { const b = document.createElement('button'); b.textContent = c.toUpperCase(); if (c === last.ch) b.className = 'pri'; b.onclick = () => { last.ch = c; last.doubt = false; renderSpell(); }; alt.appendChild(b); });
  }
  $('#btnSpell').setAttribute('aria-pressed', String(spellOn));
  $('#btnSpell').textContent = spellOn ? 'Dejar de deletrear' : 'Deletrear un nombre';
  $('#spellBox').hidden = !spellOn;
}
function onSpellEvent(e) {
  if (e.kind === 'sign') {
    const margin = e.ranks[1] ? e.ranks[1].dist - e.ranks[0].dist : 1;
    spell.push({ ch: e.word, cands: e.ranks.filter(r => isLetter(r.word)).slice(0, 3).map(r => r.word), doubt: margin < 0.03 });
    cue(margin < 0.03 ? 'doubt' : 'ok'); renderSpell();
  } else { setStageMsg('No pude leer la letra: probá de nuevo, más lento', 3000); cue('warn'); }
}
$('#btnSpell').onclick = () => { spellOn = !spellOn; spotter.reset(); spellSpotter.reset(); renderSpell(); };
$('#spellSpace').onclick = () => { if (spell.length && spell[spell.length - 1].ch !== ' ') { spell.push({ ch: ' ', cands: [] }); renderSpell(); } };
$('#spellBack').onclick = () => { spell.pop(); renderSpell(); };
$('#spellDone').onclick = () => {
  const t = spellText().trim().split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (t) { transcript.push({ word: t, cands: [t], spelled: true }); renderTranscript(); }
  spell.length = 0; renderSpell();
};

// ---------- Cejas y boca (experimental): el ceño fruncido durante una seña la marca como pregunta ----------
let flm = null, flmTry = false, flmTs = 0, flmN = 0; const browHist = [];
async function ensureFlm() {
  if (flm || flmTry || !mpKit || !mpKit.mp.FaceLandmarker) return;
  flmTry = true;
  try { flm = await mpKit.mp.FaceLandmarker.createFromOptions(mpKit.fs, { baseOptions: { modelAssetPath: mpKit.src.flm, delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true }); } catch (e) { console.warn('modelo de cara:', e.message); }
}
function faceStep(ts) {
  if (!S.face || !(tab === 'translate' || (tab === 'converse' && cvCam))) return;
  if (++flmN % 4) return;
  ensureFlm(); if (!flm || !video.videoWidth) return;
  try {
    flmTs = Math.max(flmTs + 1, ts);
    const r = flm.detectForVideo(video, flmTs), cats = r.faceBlendshapes && r.faceBlendshapes[0] && r.faceBlendshapes[0].categories; if (!cats) return;
    const g = n => (cats.find(c => c.categoryName === n) || { score: 0 }).score;
    browHist.push({ t: ts, v: (g('browDownLeft') + g('browDownRight')) / 2 });
    while (browHist.length && browHist[0].t < ts - 20000) browHist.shift();
  } catch (e) { /* sin cara */ }
}
// ¿subió el ceño fruncido, respecto de lo habitual de esa persona, mientras hacía la seña? (umbral medido con las preguntas de los videos)
function browFlag(t0, t1) {
  if (!S.face || browHist.length < 8) return false;
  const vs = browHist.map(x => x.v).sort((a, b) => a - b), base = vs[vs.length >> 1];
  const win = browHist.filter(x => x.t >= t0 - 300 && x.t <= t1 + 300);
  return win.length > 0 && Math.max(...win.map(x => x.v)) - base > 0.27;
}

// ---------- Cuenta: «Ingresar con Google» (Supabase Auth con PKCE; sin librerías de terceros) ----------
const SB = (CONFIG.supabaseUrl || '').replace(/\/+$/, '');
const AUTH_OK = !!(SB && CONFIG.supabaseKey);
const SES_KEY = 'appsign-session', PKCE_KEY = 'appsign-pkce', TERMS_VERSION = '2026-11-02';
let ses = null, profile = null;
try { ses = JSON.parse(localStorage.getItem(SES_KEY) || 'null'); } catch (e) { /* sin storage */ }
const saveSes = v => { ses = v; try { v ? localStorage.setItem(SES_KEY, JSON.stringify(v)) : localStorage.removeItem(SES_KEY); } catch (e) { /* sin storage */ } };
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sesFrom = d => ({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + ((+d.expires_in || 3600) - 30) * 1000, user: { id: d.user && d.user.id, email: d.user && d.user.email } });
async function authPost(path, body, bearer) {
  const r = await fetch(SB + path, { method: 'POST', headers: { apikey: CONFIG.supabaseKey, Authorization: 'Bearer ' + (bearer || CONFIG.supabaseKey), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.status === 204 ? null : r.json().catch(() => null);
}
async function signIn() {
  const ver = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const chal = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ver)));
  try { sessionStorage.setItem(PKCE_KEY, ver); localStorage.setItem(PKCE_KEY, ver); } catch (e) { /* sin storage */ }
  location.href = `${SB}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(location.origin + '/')}&code_challenge=${chal}&code_challenge_method=s256`;
}
async function finishSignIn() {
  const q = new URLSearchParams(location.search), code = q.get('code'), err = q.get('error_description') || q.get('error');
  if (!code && !err) return;
  history.replaceState(null, '', location.pathname);
  if (err) { acctMsg('No se pudo ingresar: ' + err); return; }
  let ver = ''; try { ver = sessionStorage.getItem(PKCE_KEY) || localStorage.getItem(PKCE_KEY) || ''; sessionStorage.removeItem(PKCE_KEY); localStorage.removeItem(PKCE_KEY); } catch (e) { /* sin storage */ }
  if (!ver) { acctMsg('No se pudo completar el ingreso. Probá de nuevo.'); return; }
  try { saveSes(sesFrom(await authPost('/auth/v1/token?grant_type=pkce', { auth_code: code, code_verifier: ver }))); } catch (e) { { console.warn('login:', e.message); acctMsg('No se pudo completar el ingreso. Probá de nuevo.'); }; }
}
async function validSes() {
  if (!ses) return null;
  if (Date.now() < ses.expires_at) return ses;
  try { saveSes(sesFrom(await authPost('/auth/v1/token?grant_type=refresh_token', { refresh_token: ses.refresh_token }))); return ses; } catch (e) { saveSes(null); profile = null; return null; }
}
async function sb(path, opts = {}) {   // pedido a Supabase con la sesión (si hay) o con la clave pública
  const t = await validSes();
  return fetch(SB + path, { ...opts, headers: { apikey: CONFIG.supabaseKey, Authorization: 'Bearer ' + (t ? t.access_token : CONFIG.supabaseKey), 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}
async function loadProfile() {
  profile = null; if (!AUTH_OK || !(await validSes())) return;
  try { const r = await sb('/rest/v1/perfiles?select=rol,pais,region,rol_verificado&limit=1'); if (r.ok) { const a = await r.json(); profile = a[0] || null; } } catch (e) { /* sin red */ }
}
function acctMsg(t) { const m = $('#acctMsg'); if (m) m.textContent = t || ''; }
const ROLES = { sorda: 'persona sorda', interprete: 'intérprete', docente: 'docente de LSA', aprendiz: 'estudiante de LSA' };
function renderAcct() {
  const c = $('#acctCard'); if (!c) return; c.hidden = !AUTH_OK; if (!AUTH_OK) return;
  const out = !ses, form = !!ses && !profile, ok = !!ses && !!profile;
  $('#acctOut').hidden = !out; $('#acctForm').hidden = !form; $('#acctIn').hidden = !ok;
  if (form) $('#acctWho').textContent = ses.user.email || 'tu cuenta';
  if (ok) $('#acctHello').textContent = `Hola, ${ses.user.email || 'colaborador/a'}. Rol: ${ROLES[profile.rol] || profile.rol} · país ${profile.pais}${profile.region ? ' · ' + profile.region : ''} · ${profile.rol_verificado ? 'verificado ✓' : 'pendiente de verificación por el equipo'}.`;
  collabUpdate(); renderValidar();
}
$('#acctGoogle').onclick = () => signIn();
$('#acctSave').onclick = async () => {
  const rol = ($('#acctRol').value || ''), pais = $('#acctPais').value, region = $('#acctRegion').value.trim().slice(0, 60) || null;
  if (!rol) { acctMsg('Elegí cómo te presentás.'); return; }
  if (!$('#acctTerms').checked) { acctMsg('Hace falta aceptar los términos de uso.'); return; }
  try {
    const r = await sb('/rest/v1/perfiles', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ usuario: ses.user.id, rol, pais, region, terminos: TERMS_VERSION, terminos_fecha: new Date().toISOString() }) });
    if (!r.ok && r.status !== 409) throw new Error('HTTP ' + r.status);
    await loadProfile(); acctMsg(profile ? '¡Listo! Ya podés mandar videos y votar con tu cuenta.' : ''); renderAcct();
  } catch (e) { { console.warn('perfil:', e.message); acctMsg('No se pudo guardar tu perfil. Probá de nuevo.'); }; }
};
$('#acctOutBtn').onclick = async () => { const t = await validSes(); try { if (t) await authPost('/auth/v1/logout', {}, t.access_token); } catch (e) { /* igual se cierra acá */ } saveSes(null); profile = null; acctMsg('Saliste de tu cuenta.'); renderAcct(); };
$('#acctDelete').onclick = async () => {
  if (!confirm('¿Borrar tu cuenta? Se elimina tu perfil y tu ingreso. Tus votos quedan sin tu nombre. No se puede deshacer.')) return;
  try { const r = await sb('/rest/v1/rpc/borrar_mi_cuenta', { method: 'POST', body: '{}' }); if (!r.ok) throw new Error('HTTP ' + r.status); saveSes(null); profile = null; acctMsg('Tu cuenta fue borrada.'); renderAcct(); }
  catch (e) { { console.warn('borrar:', e.message); acctMsg('No se pudo borrar. Escribinos desde Sugerencias y errores.'); } }
};

// ---------- Ayudar a validar: se votan señas candidatas; los votos van a un servidor y solo se leen sumados ----------
const VOTE_OK = !!(CONFIG.supabaseUrl && CONFIG.supabaseKey);
const VS_KEY = 'appsign-voter';
let voter = { id: '', role: '', region: '', voted: [], skipped: [] };
try { voter = { ...voter, ...JSON.parse(localStorage.getItem(VS_KEY) || '{}') }; } catch (e) { /* sin storage */ }
if (!voter.id) voter.id = (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const saveVoter = () => { try { localStorage.setItem(VS_KEY, JSON.stringify(voter)); } catch (e) { /* sin storage */ } };
let candidates = [], curCand = null, candTimer = 0;
async function loadCandidates() {
  if (!VOTE_OK) return;
  try {
    const r = await fetch('candidatas.json', { cache: 'no-cache' }); if (!r.ok) return;
    const d = await r.json(); if (d.format !== 'appsign-candidates-v1' || !Array.isArray(d.candidates)) return;
    const k = d.scale || 1000;
    candidates = d.candidates.filter(c => c && typeof c.id === 'string' && typeof c.word === 'string' && Array.isArray(c.frames) && c.frames.length === T && c.frames.every(fr => Array.isArray(fr) && fr.length === FRAME_LEN)).map(c => ({ id: c.id, word: normWord(c.word), raw: c.frames.map(fr => Float32Array.from(fr, v => v / k)) }));
  } catch (e) { console.warn('candidatas.json:', e.message); }
  renderValidar();
}
function nextCandidate() {
  const pend = candidates.filter(c => !voter.voted.includes(c.id) && !voter.skipped.includes(c.id));
  return pend.length ? pend[Math.floor(Math.random() * pend.length)] : null;
}
function renderValidar() {
  const card = $('#valCard'); if (!card) return;
  card.hidden = !(VOTE_OK && candidates.length);
  if (card.hidden) return;
  clearInterval(candTimer);
  const left = candidates.filter(c => !voter.voted.includes(c.id) && !voter.skipped.includes(c.id)).length;
  $('#valCount').textContent = voter.voted.length ? `Ya validaste ${voter.voted.length} ${voter.voted.length === 1 ? 'seña' : 'señas'}. ¡Gracias!` : 'Todavía no validaste ninguna.';
  const hasRole = !!(voter.role || profile);
  $('#valRole').hidden = hasRole; $('#valWork').hidden = !hasRole;
  if (!hasRole) return;
  curCand = nextCandidate();
  $('#valEmpty').hidden = !!curCand; $('#valBox').hidden = !curCand;
  if (!curCand) return;
  $('#valLeft').textContent = `Quedan ${left} por mirar`;
  $('#valWord').textContent = curCand.word; $('#valVar').value = ''; $('#valVarBox').hidden = true;
  const cv = $('#valCv'), bd = sampleBounds(curCand.raw); let k = 0; drawCmpFrame(curCand.raw[0], bd, cv);
  candTimer = setInterval(() => { k = (k + 1) % curCand.raw.length; drawCmpFrame(curCand.raw[k], bd, cv); }, 140);
}
document.querySelectorAll('#valRole button[data-role]').forEach(b => b.onclick = () => { voter.role = b.dataset.role; voter.region = $('#valRegion').value.trim().slice(0, 60); saveVoter(); renderValidar(); });
$('#valChange').onclick = () => { voter.role = ''; saveVoter(); renderValidar(); };
async function castVote(kind) {
  if (!curCand) return;
  const msg = $('#valMsg'); msg.textContent = '';
  if (kind === 'skip') { voter.skipped.push(curCand.id); saveVoter(); renderValidar(); return; }
  const body = { candidata: curCand.id, palabra: curCand.word, voto: kind, variante: ((kind === 'distinta' || kind === 'otra') && $('#valVar').value.trim().slice(0, 120)) || null, rol_declarado: (profile && profile.rol) || voter.role, region: (profile && profile.region) || voter.region || null, dispositivo: voter.id, lengua: CONFIG.lengua || 'LSA', pais: CONFIG.pais || 'AR' };
  try {
    const r = await sb('/rest/v1/votos', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) });
    if (!r.ok && r.status !== 409) throw new Error('HTTP ' + r.status);
    voter.voted.push(curCand.id); saveVoter(); cue('ok'); renderValidar();
  } catch (e) { msg.textContent = (console.warn('voto:', e.message || e.name), 'No se pudo guardar el voto. Probá de nuevo con internet.'); }
}
$('#valOk').onclick = () => castVote('correcta');
$('#valDiff').onclick = () => { $('#valVarBox').hidden = false; $('#valVar').placeholder = '¿Cómo se hace donde vivís? (opcional)'; $('#valVarSend').dataset.kind = 'distinta'; };
$('#valWrong').onclick = () => { $('#valVarBox').hidden = false; $('#valVar').placeholder = '¿Qué palabra es? (opcional)'; $('#valVarSend').dataset.kind = 'otra'; };
$('#valVarSend').onclick = () => castVote($('#valVarSend').dataset.kind || 'distinta');
$('#valSkip').onclick = () => castVote('skip');

// ---------- Sugerencias y errores ----------
const fbCheck = () => { $('#fbSend').disabled = $('#fbMsg').value.trim().length < 5; };
$('#fbMsg').addEventListener('input', fbCheck);
function fbTechInfo() { return `Appsign ${globalThis.APP_VERSION || '?'} · vocabulario ${libMeta.version || '—'} · ${(navigator.userAgent || '').replace(/\s+/g, ' ').slice(0, 150)} · ${innerWidth}x${innerHeight} · pantalla ${tab}`; }
$('#fbSend').onclick = async () => {
  const msg = $('#fbMsgOut'), tipo = $('#fbType').value, mensaje = $('#fbMsg').value.trim().slice(0, 2000), contacto = $('#fbContact').value.trim().slice(0, 120) || null, tech = $('#fbTech').checked ? fbTechInfo() : null;
  if (mensaje.length < 5) return;
  msg.textContent = '';
  if (VOTE_OK) {
    try {
      const body = { tipo, mensaje, contacto, pantalla: tab, version: String(globalThis.APP_VERSION || '').slice(0, 40), tecnico: tech && tech.slice(0, 300), lengua: CONFIG.lengua || 'LSA', pais: CONFIG.pais || 'AR', dispositivo: voter.id };
      const r = await sb('/rest/v1/sugerencias', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      $('#fbMsg').value = ''; fbCheck(); msg.textContent = '¡Gracias! Recibimos tu mensaje.'; return;
    } catch (e) { msg.textContent = (console.warn('envio:', e.message || e.name), 'No se pudo enviar. Lo intentamos por otro medio.'); }
  }
  // Sin servidor (o si falló): se manda por el menú del celular, el correo o WhatsApp del equipo
  const text = `Appsign · ${tipo === 'error' ? 'Error' : tipo === 'sugerencia' ? 'Sugerencia' : 'Mensaje'}\n\n${mensaje}${contacto ? '\n\nContacto: ' + contacto : ''}${tech ? '\n\n(' + tech + ')' : ''}`;
  if (navigator.share) { try { await navigator.share({ title: 'Appsign: ' + tipo, text }); msg.textContent = 'Listo: elegí a quién mandarlo.'; return; } catch (e) { if (e && e.name === 'AbortError') { msg.textContent = 'Envío cancelado.'; return; } } }
  if (CONFIG.email) { location.href = `mailto:${CONFIG.email}?subject=${encodeURIComponent('Appsign: ' + tipo)}&body=${encodeURIComponent(text)}`; return; }
  try { await navigator.clipboard.writeText(text); msg.textContent = 'Copiamos tu mensaje: pegalo donde quieras mandarlo al equipo.'; } catch (e) { msg.textContent = 'No pudimos enviarlo desde acá. Escribinos desde la sección Colaborar.'; }
};

// ---------- Instalar y compartir ----------
let installEvt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true || /[?&]source=(apk|pwa)/.test(location.search);
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installUI() {
  const b = $('#btnInstall'), m = $('#installMsg');
  if (standalone()) { b.style.display = 'none'; m.textContent = 'Ya estás usando la app instalada.'; return; }
  b.style.display = '';
  m.textContent = isIOS ? 'En iPhone: abrí este link en Safari, tocá Compartir y elegí «Agregar a inicio».' : installEvt ? 'Se agrega a tu pantalla de inicio y abre sin barra del navegador.' : 'Si el botón no hace nada, abrí el menú ⋮ del navegador y elegí «Instalar app».';
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; installUI(); });
window.addEventListener('appinstalled', () => { installEvt = null; installUI(); });
$('#btnInstall').onclick = async () => {
  if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch (e) { /* cancelado */ } installEvt = null; installUI(); }
  else alert(isIOS ? 'En Safari: tocá Compartir (cuadrado con flecha) y elegí «Agregar a inicio».' : 'Abrí el menú ⋮ del navegador y elegí «Instalar app» o «Agregar a la pantalla principal».');
};
$('#btnShareApp').onclick = async () => {
  const data = { title: 'Appsign', text: 'Appsign: traductor de lengua de señas argentina (prototipo)', url: location.origin + '/' };
  try {
    if (navigator.share) await navigator.share(data);
    else if (navigator.clipboard) { await navigator.clipboard.writeText(data.url); $('#installMsg').textContent = 'Link copiado: pegalo donde quieras compartirlo.'; }
    else prompt('Copiá el link:', data.url);
  } catch (e) { /* cancelado */ }
};

// ---------- Navegación ----------
function updateUI() {
  const showStage = mode && (tab === 'translate' || tab === 'converse');
  stage.classList.toggle('small', tab === 'converse');
  stage.classList.toggle('on', !!showStage);
  stage.classList.toggle('mirror', mode === 'camera' && mirrorView);
  $('#btnCam').textContent = mode === 'camera' ? 'Apagar cámara' : 'Activar cámara';
  $('#btnCam').className = mode === 'camera' ? 'wide' : 'pri wide';
  if (!mode) stageMsg.textContent = 'Cámara apagada';
  $('#btnFlip').title = $('#btnFlip').ariaLabel = S.facing === 'user' ? 'Cámara frontal: tocá para usar la trasera' : 'Cámara trasera: tocá para usar la frontal';
  if (!mode && rec) stopRecording();
}
function showTab(name) {
  tab = name; spotter.reset(); spellSpotter.reset();
  if (name !== 'translate' && spellOn) { spellOn = false; renderSpell(); }
  if (name !== 'converse') converseStop();
  (name === 'converse' ? $('#cvStageSlot') : $('main')).insertBefore(stage, name === 'converse' ? null : $('#tab-translate'));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('main > section').forEach(s => s.classList.toggle('on', s.id === 'tab-' + name));
  if (name === 'collab' || name === 'data') { if (mode) stopSource(); }
  updateUI();
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
$('#btnCam').onclick = () => (mode === 'camera' ? stopSource() : startCamera());

// ---------- Inicio ----------
(async function init() {
  loadCandidates(); loadSettingsUI(); cvApplySettings(); if (AUTH_OK) finishSignIn().then(loadProfile).then(renderAcct); else renderAcct(); cvRender(); micBtnUI(); camBtnUI(); installUI(); renderSpell(); renderTranscript(); updateUI();
  await loadLibrary();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__lsa = { version: globalThis.APP_VERSION, get lib() { return lib; }, get phrases() { return phrases; }, transcript, renderTranscript, get meta() { return libMeta; }, S, rank, prepare, resample };
})();

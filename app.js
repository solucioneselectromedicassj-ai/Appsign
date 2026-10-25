import { T, FRAME_LEN, HAND_LEN, Segmenter, resample, prepare, rank, mirrorFrame, anyPresent, presentSlot, normWord, autoThreshold, suggestPhrase } from './core.js';
import { CONFIG } from './config.js';

// ---------- Configuración ----------
const MP_VER = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const HAND_CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const COLORS = ['#38bdf8', '#fb923c'];

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Ajustes ----------
const defaults = { thr: 0.25, auto: true, lefty: false, speak: false, cvSize: 32, cvFlip: false, facing: 'environment', fs: 1, theme: 'auto', accent: 'blue', help: false, cue: true };
let S = { ...defaults };
try { S = { ...defaults, ...JSON.parse(localStorage.getItem('lsa-settings') || '{}') }; } catch (e) { /* sin storage */ }
if (!S.v) { S.cvFlip = false; S.v = 2; }
const saveS = () => { try { localStorage.setItem('lsa-settings', JSON.stringify(S)); } catch (e) { /* ignorar */ } };

// ---------- Biblioteca (solo lo que viene en library.json, publicado por el equipo) ----------
let lib = [], libMeta = { version: '', words: 0, validated: true, threshold: 0 }, phrases = [];
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
  } catch (e) { lib = []; phrases = []; libMeta = { version: '', words: 0, validated: true }; console.warn('library.json:', e.message); }
  thrMemo = null;
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
function renderLibInfo() {
  $('#testBanner').style.display = lib.length && !libMeta.validated ? '' : 'none';
  const t = lib.length ? `Vocabulario ${/^\d/.test(libMeta.version) ? 'v' : ''}${libMeta.version}: ${libMeta.words} palabras (${lib.length} muestras) · umbral ${threshold().toFixed(3)}${S.auto ? (libMeta.threshold ? ' (fijado por el equipo)' : ' (auto)') : ''}` : 'Todavía no hay vocabulario cargado en esta versión.';
  $('#libInfo').textContent = t; $('#libInfo2').textContent = t;
  const words = [...new Set(lib.map(s => s.word))].sort((a, b) => a.localeCompare(b, 'es'));
  $('#vocabList').textContent = words.join(' · ') || '—';
  $('#wordList').innerHTML = words.map(w => `<option value="${esc(w)}">`).join('');
}

// ---------- Estado de la UI ----------
let tab = 'translate';
let speakingNow = false;
const stage = $('#stage'), video = $('#video'), overlay = $('#overlay'), octx = overlay.getContext('2d'), stageMsg = $('#stageMsg');
function setStatus(t, cls = '') { const p = $('#status'); p.textContent = t; p.className = 'pill ' + cls; }

// ---------- Modelo y cámara ----------
let landmarker = null, mode = null, stream = null, running = false;

// Primero los archivos propios (carpeta mp/, funcionan sin internet); si faltan, el CDN.
const MP_SOURCES = [
  { label: 'archivos propios', mod: './mp/vision_bundle.mjs', wasm: 'mp/wasm', model: 'mp/hand_landmarker.task' },
  { label: 'CDN', mod: MP_URL, wasm: WASM_URL, model: MODEL_URL },
];

async function loadModel() {
  if (landmarker) return;
  setStatus('Cargando…');
  const fails = [];
  for (const src of MP_SOURCES) {
    let step = 'motor';
    try {
      const mp = await import(src.mod);
      step = 'wasm';
      const fs = await mp.FilesetResolver.forVisionTasks(src.wasm);
      step = 'modelo';
      const mk = delegate => mp.HandLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: src.model, delegate }, runningMode: 'VIDEO', numHands: 2,
      });
      try { landmarker = await mk('GPU'); } catch (e) { landmarker = await mk('CPU'); }
      setStatus('Reconocedor listo', 'ok');
      return;
    } catch (e) { fails.push(`${src.label} (${step}): ${e.message || e.name}`); }
  }
  throw new Error('No se pudo cargar el reconocedor. ' + fails.join(' | '));
}

async function stopSource() {
  if (typeof rec !== 'undefined' && rec) stopRecording();
  running = false;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.pause(); video.removeAttribute('src'); video.srcObject = null; video.controls = false;
  mode = null; lastMsg = '';
  octx.clearRect(0, 0, overlay.width, overlay.height);
  transSeg.reset();
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
function judge(q16) {
  const ranks = rank(prepare(q16), lib), thr = threshold();
  const accepted = ranks[0].dist <= thr;
  const margin = ranks[1] ? ranks[1].dist - ranks[0].dist : 1;
  return { ranks, thr, accepted, doubt: !accepted || margin < 0.03 };
}

// ---------- Segmentación y consumidores ----------
const transSeg = new Segmenter({ gapMs: 450, minFrames: 6, maxMs: 5000 });

let segStart = 0;
function handleFrame(ts, frame) {
  const has = anyPresent(frame);
  if (!(tab === 'translate' || (tab === 'converse' && cvCam))) return;
  const was = transSeg.active;
  const out = transSeg.push(ts, frame);
  if (!was && transSeg.active) segStart = ts;
  setStageMsg(transSeg.active ? (ts - segStart > 3500 ? 'Bajá las manos para terminar' : 'Mirando la seña…') : has ? 'Manos detectadas' : 'Listo: pedile una seña');
  if (out) { out.dur = ts - segStart; (tab === 'translate' ? onTranslateSegment : onConverseSegment)(out); }
}

// ---------- Traducir ----------
const transcript = [];
let last = null;

function onTranslateSegment(res) {
  const tip = coachFor(res);
  if (!res.ok) { setStageMsg(tip, 3500); cue('warn'); return; }
  const q16 = resample(res.frames);
  if (!lib.length) { last = { ranks: [], accepted: false, note: 'Todavía no hay vocabulario cargado en esta versión de la app.' }; renderLast(); return; }
  const j = judge(q16);
  transcript.push({ word: j.accepted ? j.ranks[0].word : null, cands: j.ranks.slice(0, 3).map(r => r.word) });
  last = { ...j, q16, idx: transcript.length - 1 };
  renderTranscript(); renderLast();
  if (tip) { setStageMsg(tip, 3500); cue('warn'); }
  else if (j.doubt) { setStageMsg('No estoy seguro/a: mirá abajo y comparalo con la persona', 3500); cue('doubt'); }
  else { setStageMsg('✓ ' + j.ranks[0].word + ' — pedile la próxima', 2500); cue('ok'); }
  if (j.accepted && S.speak) speak(j.ranks[0].word);
}

// Confirmar o corregir la palabra de la última seña (y, si la persona lo activó, guardar la corrección para el equipo)
function labelLast(word) {
  if (last && last.idx != null) { transcript[last.idx].word = word; transcript[last.idx].cands = [word]; renderTranscript(); }
  if (last) saveCorrection(word, last.q16);
}

function renderTranscript() {
  const el = $('#transcript');
  renderPhrase();
  if (!transcript.length) { el.innerHTML = '<span class="mut">Poné las manos en cuadro, hacé la seña y bajalas.</span>'; return; }
  el.innerHTML = transcript.map((t, i) => `<span class="chip ${t.phrase ? 'phrase' : t.word ? '' : 'unk'} ${i === transcript.length - 1 ? 'last' : ''}">${t.phrase ? esc(t.phrase) : t.word ? esc(t.word) : '¿?'}</span>`).join('');
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
function drawCmpFrame(fr, bd) {
  const cv = $('#cmpCv'), g = cv.getContext('2d'), W = cv.width, sc = 0.82 * W / Math.max(bd.w, bd.h);
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
    else if (CONFIG.whatsapp) window.open(`https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(text)}`, '_blank');
  }
  if (confirm('¿Ya lo mandaste? Si querés, borro las señas guardadas de este celular.')) { corrSet([]); corrUI(); }
};

$('#btnClear').onclick = () => { transcript.length = 0; last = null; renderTranscript(); renderLast(); };
$('#btnSpeak').onclick = () => speak(transcript.map(t => t.phrase || t.word).filter(Boolean).join(' '));
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
function collabUpdate() {
  $('#cSend').disabled = !(C.file && normWord($('#cWord').value) && $('#cConsent').checked);
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
$('#cContactInfo').textContent = CONFIG.email || CONFIG.whatsapp
  ? `Se envía a ${CONFIG.equipo}${CONFIG.email ? ' · ' + CONFIG.email : ''}${CONFIG.whatsapp ? ' · WhatsApp +' + CONFIG.whatsapp : ''}.`
  : 'Al enviar se abre el menú del celular para elegir cómo mandarlo (WhatsApp, correo…).';
$('#cSend').onclick = async () => {
  const f0 = C.file, w = normWord($('#cWord').value);
  if (!f0 || !w || !$('#cConsent').checked) return;
  const ext = (f0.name.split('.').pop() || (f0.type.startsWith('image/') ? 'jpg' : 'mp4')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  const f = new File([f0], `appsign-${w.replace(/[^\p{L}\p{N}]+/gu, '_')}.${ext}`, { type: f0.type });
  const text = ['Aporte para Appsign', 'Palabra: ' + w, 'Región: ' + ($('#cRegion').value.trim() || '—'), 'Contacto: ' + ($('#cContact').value.trim() || '—'),
    'Acepto que el equipo vea este archivo para validar la seña y usarla solo para el vocabulario.'].join('\n');
  $('#cMsg').textContent = '';
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], title: 'Appsign: ' + w, text }); $('#cMsg').textContent = '¡Gracias! Si elegiste dónde enviarlo, el equipo lo va a revisar.'; return; }
    catch (e) { if (e && e.name === 'AbortError') { $('#cMsg').textContent = 'Envío cancelado.'; return; } }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  if (CONFIG.email) location.href = `mailto:${CONFIG.email}?subject=${encodeURIComponent('Appsign: ' + w)}&body=${encodeURIComponent(text + '\n\n(Adjuntá el archivo descargado)')}`;
  else if (CONFIG.whatsapp) window.open(`https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(text)}`, '_blank');
  $('#cMsg').textContent = 'Se descargó el archivo. Adjuntalo al mensaje que se abre para mandarlo al equipo.';
};

// ---------- Apariencia (tamaño de letra, fondo y color) ----------
function applyLook() {
  const h = document.documentElement;
  h.style.setProperty('--fs', S.fs);
  if (S.theme === 'auto') delete h.dataset.theme; else h.dataset.theme = S.theme;
  if (S.accent === 'blue') delete h.dataset.accent; else h.dataset.accent = S.accent;
  document.querySelectorAll('[data-fs]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.fs === +S.fs)));
  document.querySelectorAll('button[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === S.theme)));
  document.querySelectorAll('button[data-accent]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.accent === S.accent)));
}
document.querySelectorAll('[data-fs]').forEach(b => b.onclick = () => { S.fs = +b.dataset.fs; saveS(); applyLook(); });
document.querySelectorAll('button[data-theme]').forEach(b => b.onclick = () => { S.theme = b.dataset.theme; saveS(); applyLook(); });
document.querySelectorAll('button[data-accent]').forEach(b => b.onclick = () => { S.accent = b.dataset.accent; saveS(); applyLook(); });

// ---------- Ajustes ----------
function loadSettingsUI() {
  applyLook(); $('#setHelp').checked = S.help; $('#setCue').checked = S.cue; corrUI();
  $('#setFacing').value = S.facing; $('#setAuto').checked = S.auto; $('#setThr').value = S.thr; $('#setLefty').checked = S.lefty; $('#setSpeak').checked = S.speak;
  updateThrLabel();
}
function updateThrLabel() { $('#thrVal').textContent = S.auto ? 'automática' : S.thr.toFixed(2); $('#setThr').disabled = S.auto; }
$('#setFacing').onchange = e => { S.facing = e.target.value; saveS(); if (mode === 'camera') startCamera(); else updateUI(); };
$('#setAuto').onchange = e => { S.auto = e.target.checked; saveS(); updateThrLabel(); renderLibInfo(); };
$('#setThr').oninput = e => { S.thr = +e.target.value; saveS(); updateThrLabel(); };
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

function onConverseSegment(res) {
  const tip = coachFor(res);
  if (!res.ok) { setStageMsg(tip, 3500); cue('warn'); return; }
  if (!lib.length) { $('#cvCamMsg').textContent = 'Todavía no hay vocabulario cargado en esta versión de la app.'; return; }
  const q16 = resample(res.frames), j = judge(q16);
  const word = j.accepted ? j.ranks[0].word : null;
  const now = Date.now();
  let line = signLines[signLines.length - 1];
  if (!line || now - line.t > 4000) { line = { t: now, words: [] }; signLines.push(line); }
  line.t = now; line.words.push(word);
  cvLast = { ranks: j.ranks, doubt: j.doubt, line, idx: line.words.length - 1, q16 };
  cvRender();
  if (tip) { setStageMsg(tip, 3500); cue('warn'); }
  else if (j.doubt) { setStageMsg('No estoy seguro/a: comparalo con la persona', 3500); cue('doubt'); }
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
  return [transcript.slice(-8).map(t => t.phrase || t.word || '¿?').join(' ')].filter(Boolean);
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
  tab = name; transSeg.reset();
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
  loadSettingsUI(); cvApplySettings(); cvRender(); micBtnUI(); camBtnUI(); renderTranscript(); updateUI();
  await loadLibrary();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__lsa = { get lib() { return lib; }, get phrases() { return phrases; }, transcript, renderTranscript, get meta() { return libMeta; }, S, rank, prepare, resample };
})();

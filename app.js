import { T, FRAME_LEN, HAND_LEN, Segmenter, resample, prepare, rank, mirrorFrame, anyPresent, presentSlot, normWord, autoThreshold } from './core.js';
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
const defaults = { thr: 0.3, auto: true, lefty: false, speak: false, cvSize: 32, cvFlip: false, facing: 'environment' };
let S = { ...defaults };
try { S = { ...defaults, ...JSON.parse(localStorage.getItem('lsa-settings') || '{}') }; } catch (e) { /* sin storage */ }
if (!S.v) { S.cvFlip = false; S.v = 2; }
const saveS = () => { try { localStorage.setItem('lsa-settings', JSON.stringify(S)); } catch (e) { /* ignorar */ } };

// ---------- Biblioteca (solo lo que viene en library.json, publicado por el equipo) ----------
let lib = [], libMeta = { version: '', words: 0 };
const libOf = () => lib;
let thrMemo = null;
function threshold() {
  if (!S.auto) return S.thr;
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
    lib = d.samples.filter(validSample).map((s, i) => ({ id: i, word: normWord(s.word), feat: prepare(s.frames.map(fr => Float32Array.from(fr, v => v / k))) })).filter(s => s.word);
    libMeta = { version: String(d.version || ''), words: new Set(lib.map(s => s.word)).size };
  } catch (e) { lib = []; libMeta = { version: '', words: 0 }; console.warn('library.json:', e.message); }
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
  const t = lib.length ? `Vocabulario v${libMeta.version}: ${libMeta.words} palabras (${lib.length} muestras) · umbral ${threshold().toFixed(3)}${S.auto ? ' (auto)' : ''}` : 'Todavía no hay vocabulario cargado en esta versión.';
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

function setStageMsg(t) { if (t !== lastMsg) { lastMsg = t; stageMsg.textContent = t; } }

// ---------- Segmentación y consumidores ----------
const transSeg = new Segmenter({ gapMs: 450, minFrames: 6, maxMs: 5000 });

function handleFrame(ts, frame) {
  const has = anyPresent(frame);
  if (tab === 'translate') {
    const out = transSeg.push(ts, frame);
    setStageMsg(transSeg.active ? `Capturando… ${transSeg.count} frames` : has ? 'Manos detectadas' : 'Esperando manos…');
    if (out) onTranslateSegment(out);
  } else if (tab === 'converse') {
    if (!cvOn) return;
    const out = transSeg.push(ts, frame);
    setStageMsg(transSeg.active ? `Capturando seña… ${transSeg.count}` : has ? 'Manos detectadas' : 'Esperando señas…');
    if (out) onConverseSegment(out);
  }
}

// ---------- Traducir ----------
const transcript = [];
let last = null;

function onTranslateSegment(res) {
  if (!res.ok) { setStageMsg('Seña demasiado corta, ignorada'); return; }
  const q16 = resample(res.frames);
  if (!lib.length) { last = { ranks: [], accepted: false, note: 'Todavía no hay vocabulario cargado en esta versión de la app.' }; renderLast(); return; }
  const ranks = rank(prepare(q16), lib);
  const thr = threshold();
  const accepted = ranks[0].dist <= thr;
  transcript.push({ word: accepted ? ranks[0].word : null });
  last = { ranks, thr, accepted, idx: transcript.length - 1 };
  renderTranscript(); renderLast();
  if (accepted && S.speak) speak(ranks[0].word);
}

function renderTranscript() {
  const el = $('#transcript');
  if (!transcript.length) { el.innerHTML = '<span class="mut">Poné las manos en cuadro, hacé la seña y bajalas.</span>'; return; }
  el.innerHTML = transcript.map((t, i) => `<span class="chip ${t.word ? '' : 'unk'} ${i === transcript.length - 1 ? 'last' : ''}">${t.word ? esc(t.word) : '¿?'}</span>`).join('');
}

function renderLast() {
  const card = $('#lastCard');
  if (!last) { card.style.display = 'none'; return; }
  card.style.display = '';
  const info = $('#lastInfo'), act = $('#lastActions');
  act.innerHTML = '';
  if (last.note) { info.textContent = last.note; return; }
  const top = last.ranks[0];
  info.innerHTML = last.accepted
    ? `Reconocida: <b>${esc(top.word)}</b>`
    : 'No la reconozco: puede que todavía no esté en el vocabulario.';
  last.ranks.slice(0, 3).forEach(r => {
    const b = document.createElement('button');
    b.textContent = 'Era: ' + r.word;
    b.onclick = () => { if (last.idx != null) { transcript[last.idx].word = r.word; renderTranscript(); } };
    act.appendChild(b);
  });
  const t = document.createElement('button');
  t.textContent = 'Es una seña nueva: enviarla al equipo';
  t.onclick = () => showTab('collab');
  act.appendChild(t);
}

$('#btnClear').onclick = () => { transcript.length = 0; last = null; renderTranscript(); renderLast(); };
$('#btnSpeak').onclick = () => speak(transcript.filter(t => t.word).map(t => t.word).join(' '));
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

// ---------- Ajustes ----------
function loadSettingsUI() {
  $('#setFacing').value = S.facing; $('#setAuto').checked = S.auto; $('#setThr').value = S.thr; $('#setLefty').checked = S.lefty; $('#setSpeak').checked = S.speak;
  updateThrLabel();
}
function updateThrLabel() { $('#thrVal').textContent = S.auto ? 'automática' : S.thr.toFixed(2); $('#setThr').disabled = S.auto; }
$('#setFacing').onchange = e => { S.facing = e.target.value; saveS(); if (mode === 'camera') startCamera(); else updateUI(); };
$('#setAuto').onchange = e => { S.auto = e.target.checked; saveS(); updateThrLabel(); renderLibInfo(); };
$('#setThr').oninput = e => { S.thr = +e.target.value; saveS(); updateThrLabel(); };
$('#setLefty').onchange = e => { S.lefty = e.target.checked; saveS(); };
$('#setSpeak').onchange = e => { S.speak = e.target.checked; saveS(); };

// ---------- Conversar ----------
let cvOn = false, recog = null, micOn = false;
const voiceLines = [], signLines = []; // signLines: [{t, words:[]}]
let cvLast = null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function cvRender() {
  const esc2 = esc;
  $('#cvVoiceLog').innerHTML = voiceLines.slice(-6).map(t => `<p class="ln">${esc2(t)}</p>`).join('');
  $('#cvSignLog').innerHTML = signLines.slice(-6).map(l => `<p class="ln">${l.words.map(w => w || '¿?').map(esc2).join(' ')}</p>`).join('');
  const alt = $('#cvAlt'); alt.innerHTML = '';
  if (cvLast && cvLast.ranks.length) {
    cvLast.ranks.slice(0, 3).forEach(r => {
      const b = document.createElement('button'); b.textContent = 'Era: ' + r.word;
      b.onclick = () => { cvLast.line.words[cvLast.idx] = r.word; cvRender(); };
      alt.appendChild(b);
    });
  }
}
function cvApplySettings() {
  $('#tab-converse').style.setProperty('--cvsize', S.cvSize + 'px');
  $('#cvSize').value = S.cvSize; $('#cvSign').classList.toggle('flip', S.cvFlip); $('#cvFlipBtn').setAttribute('aria-pressed', S.cvFlip); $('#cvFlipBtn').textContent = S.cvFlip ? 'Volver a enderezar' : 'Girar cuadro';
}
$('#cvSize').oninput = e => { S.cvSize = +e.target.value; saveS(); cvApplySettings(); };
$('#cvFlipBtn').onclick = () => { S.cvFlip = !S.cvFlip; saveS(); cvApplySettings(); };

function onConverseSegment(res) {
  if (!res.ok) return;
  if (!lib.length) { $('#cvMsg').textContent = 'Todavía no hay vocabulario cargado en esta versión de la app.'; return; }
  const ranks = rank(prepare(resample(res.frames)), lib), thr = threshold();
  const word = ranks[0].dist <= thr ? ranks[0].word : null;
  const now = Date.now();
  let line = signLines[signLines.length - 1];
  if (!line || now - line.t > 4000) { line = { t: now, words: [] }; signLines.push(line); }
  line.t = now; line.words.push(word);
  cvLast = { ranks, line, idx: line.words.length - 1 };
  cvRender();
}

function addSpeech(text) { if (text) { voiceLines.push(text); cvRender(); } }
function startMic() {
  if (!SR) { $('#cvMsg').textContent = 'Este navegador no trae reconocimiento de voz: la parte de señas funciona igual. Para voz usá Chrome en Android o en computadora.'; return false; }
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
      micOn = false; $('#micDot').classList.remove('on');
      $('#cvMsg').textContent = 'Sin permiso para el micrófono. Habilitalo en el navegador para ver lo que dice la otra persona.';
    }
  };
  micOn = true;
  try { recog.start(); } catch (e) { return false; }
  $('#micDot').classList.add('on');
  return true;
}
function stopMic() { micOn = false; try { recog && recog.stop(); } catch (e) { /* nada */ } $('#micDot').classList.remove('on'); $('#cvInterim').textContent = ''; }
function converseStop() {
  if (!cvOn && !micOn) return;
  cvOn = false; stopMic();
  $('#cvStart').style.display = ''; $('#cvStop').style.display = 'none';
}
$('#cvStart').onclick = async () => {
  cvOn = true; $('#cvStart').style.display = 'none'; $('#cvStop').style.display = '';
  $('#cvMsg').textContent = 'Escuchando y mirando. Hablá o señá con las manos en cuadro.';
  startMic();
  await startCamera();
};
$('#cvStop').onclick = () => { converseStop(); stopSource(); $('#cvMsg').textContent = 'Conversación terminada.'; };
$('#cvClear').onclick = () => { voiceLines.length = 0; signLines.length = 0; cvLast = null; cvRender(); };
$('#cvSay').onclick = () => { const v = $('#cvType').value.trim(); if (v) { speak(v); voiceLines.push('Tú: ' + v); cvRender(); $('#cvType').value = ''; } };
$('#cvType').addEventListener('keydown', e => { if (e.key === 'Enter') $('#cvSay').click(); });


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
  return [transcript.slice(-8).map(t => t.word || '¿?').join(' ')].filter(Boolean);
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
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('main > section').forEach(s => s.classList.toggle('on', s.id === 'tab-' + name));
  if (name === 'collab' || name === 'data') { if (mode) stopSource(); }
  updateUI();
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
$('#btnCam').onclick = () => (mode === 'camera' ? stopSource() : startCamera());

// ---------- Inicio ----------
(async function init() {
  loadSettingsUI(); cvApplySettings(); cvRender(); renderTranscript(); updateUI();
  await loadLibrary();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__lsa = { get lib() { return lib; }, get meta() { return libMeta; }, S, rank, prepare, resample };
})();

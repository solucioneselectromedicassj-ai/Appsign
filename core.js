// core.js — lógica pura (sin DOM): segmentación, remuestreo, features, DTW y ranking.
// Un "frame" crudo = Float32Array/Array de 126 números: 2 manos (slot 0 y 1) x 21 puntos x (x,y,z).
// Mano ausente = 63 ceros.

export const T = 16;                 // frames por muestra tras remuestrear
export const NPTS = 21;
export const HAND_LEN = NPTS * 3;    // 63
export const FRAME_LEN = HAND_LEN * 2; // 126
const FEAT_PER_HAND = HAND_LEN + 2;  // 63 relativos + posición (x,y) de la muñeca
export const FEAT_LEN = FEAT_PER_HAND * 2;
const POS_W = 2;                     // peso de la posición global de la mano

export function presentSlot(frame, slot) {
  const b = slot * HAND_LEN;
  return frame[b] !== 0 || frame[b + 1] !== 0;
}
export function anyPresent(frame) {
  return !!frame && (presentSlot(frame, 0) || presentSlot(frame, 1));
}

// Espeja horizontalmente (para zurdos): intercambia manos y x -> 1 - x
export function mirrorFrame(frame) {
  const out = new Float32Array(FRAME_LEN);
  for (let slot = 0; slot < 2; slot++) {
    if (!presentSlot(frame, slot)) continue;
    const src = slot * HAND_LEN, dst = (1 - slot) * HAND_LEN;
    for (let p = 0; p < NPTS; p++) {
      out[dst + p * 3] = 1 - frame[src + p * 3];
      out[dst + p * 3 + 1] = frame[src + p * 3 + 1];
      out[dst + p * 3 + 2] = frame[src + p * 3 + 2];
    }
  }
  return out;
}

const r3 = v => Math.round(v * 1000) / 1000;

// Lleva una secuencia de largo variable a n frames (interpolación lineal por mano).
export function resample(frames, n = T) {
  const m = frames.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const pos = m === 1 ? 0 : (i * (m - 1)) / (n - 1);
    const a = Math.floor(pos), b = Math.min(a + 1, m - 1), f = pos - a;
    const fa = frames[a], fb = frames[b];
    const o = new Array(FRAME_LEN).fill(0);
    for (let slot = 0; slot < 2; slot++) {
      const pa = presentSlot(fa, slot), pb = presentSlot(fb, slot);
      for (let k = 0; k < HAND_LEN; k++) {
        const idx = slot * HAND_LEN + k;
        if (pa && pb) o[idx] = r3(fa[idx] * (1 - f) + fb[idx] * f);
        else if (pa) o[idx] = r3(fa[idx]);
        else if (pb) o[idx] = r3(fb[idx]);
      }
    }
    out.push(o);
  }
  return out;
}

// Vector de características invariante a escala y traslación de la mano (más la posición global).
export function frameFeatures(frame) {
  const out = new Float32Array(FEAT_LEN);
  for (let slot = 0; slot < 2; slot++) {
    if (!presentSlot(frame, slot)) continue;
    const b = slot * HAND_LEN, o = slot * FEAT_PER_HAND;
    const wx = frame[b], wy = frame[b + 1], wz = frame[b + 2];
    const dx = frame[b + 27] - wx, dy = frame[b + 28] - wy, dz = frame[b + 29] - wz; // muñeca -> nudillo medio
    const s = Math.hypot(dx, dy, dz) || 1e-6;
    for (let p = 0; p < NPTS; p++) {
      out[o + p * 3] = (frame[b + p * 3] - wx) / s;
      out[o + p * 3 + 1] = (frame[b + p * 3 + 1] - wy) / s;
      out[o + p * 3 + 2] = (frame[b + p * 3 + 2] - wz) / s;
    }
    out[o + HAND_LEN] = (wx - 0.5) * POS_W;
    out[o + HAND_LEN + 1] = (wy - 0.5) * POS_W;
  }
  return out;
}
export const prepare = frames => frames.map(frameFeatures);

function fdist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s / a.length);
}

// DTW con banda (Sakoe-Chiba) entre dos secuencias de features. Devuelve distancia normalizada.
export function dtw(A, B, band = 3) {
  const n = A.length, m = B.length, INF = 1e9;
  const D = Array.from({ length: n }, () => new Float64Array(m).fill(INF));
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - band), j1 = Math.min(m - 1, i + band);
    for (let j = j0; j <= j1; j++) {
      const c = fdist(A[i], B[j]);
      let best = 0;
      if (i === 0 && j === 0) best = 0;
      else {
        best = INF;
        if (i > 0 && D[i - 1][j] < best) best = D[i - 1][j];
        if (j > 0 && D[i][j - 1] < best) best = D[i][j - 1];
        if (i > 0 && j > 0 && D[i - 1][j - 1] < best) best = D[i - 1][j - 1];
      }
      D[i][j] = c + best;
    }
  }
  return D[n - 1][m - 1] / (n + m);
}

// library: [{id, word, feat}] ; devuelve palabras ordenadas por la mejor distancia de cualquiera de sus muestras
export function rank(queryFeat, library) {
  const best = new Map();
  for (const s of library) {
    const d = dtw(queryFeat, s.feat);
    const cur = best.get(s.word);
    if (!cur || d < cur.dist) best.set(s.word, { word: s.word, dist: d, id: s.id });
  }
  return [...best.values()].sort((a, b) => a.dist - b.dist);
}

// Corta el flujo de frames en segmentos: empieza cuando aparece una mano y termina
// cuando las manos desaparecen gapMs, o a los maxMs.
export class Segmenter {
  constructor({ gapMs = 500, minFrames = 6, maxMs = 5000 } = {}) {
    Object.assign(this, { gapMs, minFrames, maxMs });
    this.reset();
  }
  reset() { this.frames = []; this.active = false; this.lastSeen = 0; this.startT = 0; }
  get count() { return this.frames.length; }
  push(t, frame) {
    const has = anyPresent(frame);
    if (!this.active) {
      if (!has) return null;
      this.active = true; this.startT = t; this.lastSeen = t; this.frames = [frame];
      return null;
    }
    this.frames.push(has ? frame : new Float32Array(FRAME_LEN));
    if (has) this.lastSeen = t;
    if (t - this.lastSeen >= this.gapMs || t - this.startT >= this.maxMs) return this._finish();
    return null;
  }
  force() { return this.active ? this._finish() : null; }
  _finish() {
    const f = this.frames;
    while (f.length && !anyPresent(f[f.length - 1])) f.pop();
    this.reset();
    return { ok: f.length >= this.minFrames, frames: f };
  }
}

export function normWord(w) {
  return (w || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Umbral automático de rechazo: 1.6 x percentil 90 de la distancia al vecino más cercano
// de la MISMA palabra dentro de la biblioteca (necesita palabras con >= 2 muestras).
export function autoThreshold(lib, fallback = 0.6) {
  const byWord = new Map();
  for (const s of lib) { if (!byWord.has(s.word)) byWord.set(s.word, []); byWord.get(s.word).push(s); }
  const ds = [];
  for (const arr of byWord.values()) {
    if (arr.length < 2) continue;
    for (let i = 0; i < arr.length; i++) {
      let best = Infinity;
      for (let j = 0; j < arr.length; j++) if (j !== i) best = Math.min(best, dtw(arr[i].feat, arr[j].feat));
      ds.push(best);
    }
  }
  if (ds.length < 3) return fallback;
  ds.sort((a, b) => a - b);
  const p90 = ds[Math.floor(0.9 * (ds.length - 1))];
  return Math.max(0.03, p90 * 1.6);
}

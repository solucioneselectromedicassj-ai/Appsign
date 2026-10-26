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

// Frases: ¿las últimas señas leídas encajan con el comienzo, el final y buena parte del medio de una frase conocida?
// entries: [{word, cands:[palabras candidatas]}] ; phrases: [{signs:[...], text}]
// Devuelve {phrase, kind:'full'|'prefix', n, matched} o null. No inventa nada: solo propone frases de la lista del equipo.
export function suggestPhrase(entries, phrases) {
  const has = (e, w) => !!e && (e.cands || (e.word ? [e.word] : [])).includes(w);
  let best = null;
  for (const ph of phrases || []) {
    const n = ph.signs.length; if (n < 2) continue;
    if (entries.length >= n) {
      const win = entries.slice(-n); let m = 0;
      win.forEach((e, i) => { if (has(e, ph.signs[i])) m++; });
      if (has(win[0], ph.signs[0]) && has(win[n - 1], ph.signs[n - 1]) && m / n >= 0.6) {
        const score = m / n + n * 0.01;
        if (!best || score > best.score) best = { phrase: ph, kind: 'full', n, matched: m, score };
      }
    }
    for (let k = Math.min(n - 1, entries.length); k >= 2; k--) {
      const win = entries.slice(-k);
      if (win.every((e, i) => has(e, ph.signs[i]))) {
        const score = (k / n) * 0.9;
        if (!best || score > best.score) best = { phrase: ph, kind: 'prefix', n, matched: k, score };
        break;
      }
    }
  }
  return best;
}

// Lectura continua: en vez de esperar a que las manos salgan del cuadro, compara cada 0,2 s los últimos 0,8 a 2,6 s
// contra el vocabulario y avisa cuando una seña se reconoce con claridad. Sirve para señas seguidas y con una mano apoyada.
// Eventos: {kind:'sign', ...}, {kind:'unknown', ...} (hubo movimiento pero nada se parece) o {kind:'short'} (muy corto).
export class Spotter {
  constructor({ lens = [0.8, 1.2, 1.8, 2.6], step = 0.2, hold = 0.5, minRatio = 0.7 } = {}) {
    Object.assign(this, { lens, step, hold, minRatio });
    this.lib = []; this.thr = 0.3; this.reset();
  }
  setLibrary(lib, thr) { this.lib = lib; this.thr = thr; }
  reset() { this.buf = []; this.lastEval = -1e9; this.pending = null; this.lastEmit = null; this.runStart = null; this.absentSince = null; this.emitted = false; this.bestUnknown = null; }
  _ov(a, b) { return Math.max(0, Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0)); }
  _eval(t) {
    let best = null;
    for (const len of this.lens) {
      const win = this.buf.filter(x => x.t > t - len);
      if (win.length < 6) continue;
      if (win.filter(x => anyPresent(x.f)).length / win.length < this.minRatio) continue;
      const fr = win.map(x => x.f);
      while (fr.length && !anyPresent(fr[0])) fr.shift();
      while (fr.length && !anyPresent(fr[fr.length - 1])) fr.pop();
      if (fr.length < 6) continue;
      const q16 = resample(fr), ranks = rank(prepare(q16), this.lib);
      if (!ranks.length) continue;
      const c = { t0: t - len, t1: t, word: ranks[0].word, dist: ranks[0].dist, ranks, q16 };
      if (!best || c.dist < best.dist) best = c;
    }
    return best;
  }
  _sign(c) { this.lastEmit = { t0: c.t0, t1: c.t1 }; this.emitted = true; return { kind: 'sign', word: c.word, dist: c.dist, ranks: c.ranks, q16: c.q16, dur: (c.t1 - c.t0) * 1000 }; }
  // t en milisegundos; devuelve una lista de eventos (casi siempre vacía)
  push(tMs, frame) {
    const t = tMs / 1000, has = anyPresent(frame), ev = [];
    this.buf.push({ t, f: frame });
    while (this.buf.length && this.buf[0].t < t - 3.2) this.buf.shift();
    if (has) { if (this.runStart == null) { this.runStart = t; this.emitted = false; this.bestUnknown = null; } this.absentSince = null; }
    else if (this.absentSince == null) this.absentSince = t;
    if (this.lib.length && t - this.lastEval >= this.step && this.buf.some(x => x.t > t - 0.4 && anyPresent(x.f))) {
      this.lastEval = t;
      const c = this._eval(t);
      if (c) {
        if (!this.bestUnknown || c.dist < this.bestUnknown.dist) this.bestUnknown = c;
        const dup = this.lastEmit && this._ov(c, this.lastEmit) > 0.4 * Math.min(c.t1 - c.t0, this.lastEmit.t1 - this.lastEmit.t0);
        if (c.dist <= this.thr && !dup) {
          if (!this.pending) this.pending = { c, at: t };
          else if (this._ov(c, this.pending.c) > 0) { if (c.dist < this.pending.c.dist) this.pending = { c, at: t }; }
          else { ev.push(this._sign(this.pending.c)); this.pending = { c, at: t }; }
        }
      }
    }
    if (this.pending && (t - this.pending.at >= this.hold || (this.absentSince != null && t - this.absentSince >= 0.3))) { ev.push(this._sign(this.pending.c)); this.pending = null; }
    if (this.runStart != null) {
      const gone = this.absentSince != null && t - this.absentSince >= 0.6, long = has && t - this.runStart > 5;
      if (gone || long) {
        const dur = (this.absentSince != null ? this.absentSince : t) - this.runStart;
        if (!this.emitted) {
          if (dur < 0.5) ev.push({ kind: 'short', dur: dur * 1000 });
          else if (this.bestUnknown) ev.push({ kind: 'unknown', ranks: this.bestUnknown.ranks, q16: this.bestUnknown.q16, dist: this.bestUnknown.dist, dur: dur * 1000 });
        }
        this.runStart = gone ? null : t; this.emitted = false; this.bestUnknown = null; if (gone) this.lastEmit = null;
      }
    }
    return ev;
  }
}

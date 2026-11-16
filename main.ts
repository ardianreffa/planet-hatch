// The Planet Hatches: procedural 1024x1024 PNG, Node standard library only.
// Deterministic: seeded PRNG, no Math.random, no Date, no network.
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const W = 1024, H = 1024;

// ---------- seeded PRNG ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x0E66C0DE);

// ---------- helpers ----------
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// ---------- value noise ----------
const perm = new Uint8Array(512), nval = new Float32Array(256);
{
  const p = [];
  for (let i = 0; i < 256; i++) { p.push(i); nval[i] = rnd(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
function noise3(x, y, z) {
  const xf = Math.floor(x), yf = Math.floor(y), zf = Math.floor(z);
  let u = x - xf, v = y - yf, w = z - zf;
  u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v); w = w * w * (3 - 2 * w);
  const X = xf & 255, Y = yf & 255, Z = zf & 255;
  const A = perm[X] + Y, B = perm[X + 1] + Y;
  const AA = perm[A] + Z, AB = perm[A + 1] + Z, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  const a = mix(nval[perm[AA]], nval[perm[BA]], u), b = mix(nval[perm[AB]], nval[perm[BB]], u);
  const c = mix(nval[perm[AA + 1]], nval[perm[BA + 1]], u), d = mix(nval[perm[AB + 1]], nval[perm[BB + 1]], u);
  return mix(mix(a, b, v), mix(c, d, v), w);
}
function fbm3(x, y, z, oct) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z); n += a; x = x * 2.03 + 11.7; y = y * 2.03 + 5.3; z = z * 2.03 + 7.1; a *= 0.5; }
  return s / n;
}

// ---------- scene geometry ----------
const PX = 548, PY = 492, R = 282;           // planet centre and radius
const PHI = -0.30;                           // tilt of the crack axis
const EXx = Math.cos(PHI), EXy = Math.sin(PHI), EYx = -Math.sin(PHI), EYy = Math.cos(PHI);
const ALPHA = -0.43;                         // lid rotation (opens to the right)
const CA = Math.cos(ALPHA), SA = Math.sin(ALPHA);
const PIVX = -R, PIVY = -0.2 * R;            // hinge (planet-local)
const TX = 0.03 * R, TY = -0.07 * R;         // lid lift (planet-local)

const zigBase = (x) => { const t = x / R; return -0.20 * R + 0.16 * R * Math.sqrt(Math.max(0, 1 - t * t)); };

// jagged egg-crack polyline (planet-local), monotone in x
const zigPts = [];
{
  let x = -1.08 * R, s = 1;
  while (x < 1.1 * R) {
    const amp = (0.06 + 0.07 * rnd()) * R;
    zigPts.push([x, zigBase(clamp(x, -R, R)) + s * amp, s]);
    x += (0.15 + 0.10 * rnd()) * R; s = -s;
  }
}
const ZN = 4096, ZX0 = -1.12 * R, ZX1 = 1.12 * R;
const zigT = new Float32Array(ZN + 1);
{
  let k = 0;
  for (let i = 0; i <= ZN; i++) {
    const x = ZX0 + (ZX1 - ZX0) * i / ZN;
    while (k < zigPts.length - 2 && zigPts[k + 1][0] < x) k++;
    const a = zigPts[k], b = zigPts[k + 1];
    const t = clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
    zigT[i] = mix(a[1], b[1], t);
  }
}
function zig(x) {
  const f = clamp((x - ZX0) / (ZX1 - ZX0), 0, 0.99999) * ZN; const i = f | 0;
  return mix(zigT[i], zigT[i + 1], f - i);
}

// ---------- planet-local grids: albedo + crack field ----------
const GN = 720, GR = 1.03 * R;
const gAr = new Float32Array(GN * GN), gAg = new Float32Array(GN * GN), gAb = new Float32Array(GN * GN);
const gV = new Float32Array(GN * GN).fill(99);
for (let j = 0; j < GN; j++) {
  for (let i = 0; i < GN; i++) {
    const lx = (i / (GN - 1) * 2 - 1) * GR, ly = (j / (GN - 1) * 2 - 1) * GR;
    const r2 = (lx * lx + ly * ly) / (R * R);
    const z = Math.sqrt(Math.max(0, 1 - r2));
    const x = lx / R, y = ly / R;
    const h = fbm3(x * 2.1 + 3.1, y * 2.1 + 9.2, z * 2.1 + 1.7, 6);
    const shallow = smooth(0.40, 0.515, h);
    let r = mix(0.004, 0.01, shallow), g = mix(0.07, 0.42, shallow), b = mix(0.30, 0.55, shallow);
    const land = smooth(0.515, 0.535, h);
    const hi = smooth(0.55, 0.68, h);
    const lr = mix(0.05, 0.50, hi), lg = mix(0.36, 0.36, hi), lb = mix(0.10, 0.12, hi);
    r = mix(r, lr, land); g = mix(g, lg, land); b = mix(b, lb, land);
    const c = fbm3(x * 3.3 + 20 + 0.6 * h, y * 4.6 + 31, z * 3.3 + 17, 5);
    const cl = smooth(0.57, 0.72, c) * 0.55;
    r = mix(r, 0.95, cl); g = mix(g, 0.97, cl); b = mix(b, 1.0, cl);
    const k = j * GN + i; gAr[k] = r; gAg[k] = g; gAb[k] = b;
  }
}
function crackSeg(ax, ay, bx, by, wa, wb) {
  const reach = 26 * Math.max(wa, wb), sc = (GN - 1) / (2 * GR);
  const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach + GR) * sc)), i1 = Math.min(GN - 1, Math.ceil((Math.max(ax, bx) + reach + GR) * sc));
  const j0 = Math.max(0, Math.floor((Math.min(ay, by) - reach + GR) * sc)), j1 = Math.min(GN - 1, Math.ceil((Math.max(ay, by) + reach + GR) * sc));
  const ex = bx - ax, ey = by - ay, ee = ex * ex + ey * ey || 1e-9;
  for (let j = j0; j <= j1; j++) {
    const ly = j / sc - GR;
    for (let i = i0; i <= i1; i++) {
      const lx = i / sc - GR;
      const t = clamp(((lx - ax) * ex + (ly - ay) * ey) / ee, 0, 1);
      const dx = lx - ax - ex * t, dy = ly - ay - ey * t;
      const v = Math.sqrt(dx * dx + dy * dy) / mix(wa, wb, t);
      const k = j * GN + i; if (v < gV[k]) gV[k] = v;
    }
  }
}
for (let i = 0; i < zigPts.length - 1; i++) crackSeg(zigPts[i][0], zigPts[i][1], zigPts[i + 1][0], zigPts[i + 1][1], 1.7, 1.7);
function branch(x, y, ang, len, w, depth) {
  const step = 0.065 * R; const n = Math.max(2, Math.round(len / step));
  for (let i = 0; i < n; i++) {
    const a2 = ang + (rnd() - 0.5) * 1.0;
    const nx = x + Math.cos(a2) * step, ny = y + Math.sin(a2) * step;
    const w2 = w * (1 - 0.8 / n);
    crackSeg(x, y, nx, ny, w, Math.max(0.5, w2));
    if (depth < 2 && rnd() < 0.3) branch(nx, ny, ang + (rnd() < 0.5 ? -0.9 : 0.9), len * (1 - (i + 1) / n) * 0.8 + 0.06 * R, w2 * 0.7, depth + 1);
    x = nx; y = ny; w = Math.max(0.5, w2);
  }
}
for (let i = 1; i < zigPts.length - 1; i++) {
  const p = zigPts[i];
  if (rnd() < 0.2) continue;
  branch(p[0], p[1], (p[2] > 0 ? 1 : -1) * (Math.PI / 2) + (rnd() - 0.5) * 0.7, (0.22 + 0.5 * rnd()) * R, 3.8, 0);
}

// ---------- key points ----------
const l2sx = (lx, ly) => PX + EXx * lx + EYx * ly, l2sy = (lx, ly) => PY + EXy * lx + EYy * ly;
const capFx = (qx, qy) => PIVX + CA * (qx - PIVX) - SA * (qy - PIVY) + TX;
const capFy = (qx, qy) => PIVY + SA * (qx - PIVX) + CA * (qy - PIVY) + TY;
const g0x = 0.42 * R, g0y = zigBase(g0x);
const gLx = (g0x + capFx(g0x, g0y)) / 2, gLy = (g0y + capFy(g0x, g0y)) / 2;
const GX = l2sx(gLx, gLy), GY = l2sy(gLx, gLy);      // heart of the burst
const FAN = Math.atan2(GY - PY, GX - PX) - 0.15;     // main direction of the opening
const ASTX = 258, ASTY = 874, ASTS = 1.12;           // astronaut feet + scale

// ---------- ray tables ----------
const RN = 4096; const ray1 = new Float32Array(RN + 1), ray2 = new Float32Array(RN + 1);
function addLobe(tab, c, w, a) {
  for (let i = 0; i <= RN; i++) {
    let d = (i / RN) * 2 * Math.PI - Math.PI - c;
    d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    tab[i] += a * Math.exp(-(d * d) / (w * w));
  }
}
const fanW = (c) => { let d = c - FAN; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; return 0.38 + 0.9 * Math.exp(-(d * d) / 1.3); };
for (let i = 0; i < 46; i++) { const c = rnd() * 2 * Math.PI - Math.PI; addLobe(ray1, c, 0.025 + 0.085 * rnd(), (0.25 + 0.75 * rnd() * rnd()) * fanW(c)); }
for (let i = 0; i < 30; i++) { const c = rnd() * 2 * Math.PI - Math.PI; addLobe(ray2, c, 0.008 + 0.022 * rnd(), (0.4 + 0.6 * rnd()) * fanW(c)); }
{
  const c = Math.atan2(ASTY - 40 - GY, ASTX + 30 - GX);
  addLobe(ray1, c, 0.10, 0.75); addLobe(ray2, c + 0.02, 0.05, 0.7);
  addLobe(ray1, FAN, 0.16, 0.8); addLobe(ray2, FAN - 0.3, 0.03, 1.0); addLobe(ray2, FAN + 0.42, 0.035, 1.0);
}
function rayAt(tab, th) { const f = (th + Math.PI) / (2 * Math.PI) * RN; const i = clamp(f | 0, 0, RN - 1); return mix(tab[i], tab[i + 1], f - i); }

// ---------- float buffers ----------
const bg = new Float32Array(W * H * 3), trail = new Float32Array(W * H * 3), over = new Float32Array(W * H * 3);
function addLine(buf, x0, y0, x1, y1, w0, w1, i0, i1, r, g, b) {
  const pad = Math.max(w0, w1) * 3 + 1;
  const xa = Math.max(0, Math.floor(Math.min(x0, x1) - pad)), xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + pad));
  const ya = Math.max(0, Math.floor(Math.min(y0, y1) - pad)), yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + pad));
  const ex = x1 - x0, ey = y1 - y0, ee = ex * ex + ey * ey || 1e-9;
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
    const px = x + 0.5 - x0, py = y + 0.5 - y0;
    const t = clamp((px * ex + py * ey) / ee, 0, 1);
    const dx = px - ex * t, dy = py - ey * t, w = mix(w0, w1, t);
    const I = mix(i0, i1, t) * Math.exp(-(dx * dx + dy * dy) / (w * w));
    if (I < 0.002) continue;
    const k = (y * W + x) * 3; buf[k] += r * I; buf[k + 1] += g * I; buf[k + 2] += b * I;
  }
}

// ---------- background: sky, nebula, rays, inner star ----------
const BLX = 0.06 * R, BLY = -0.06 * R;
const ballX = l2sx(BLX, BLY), ballY = l2sy(BLX, BLY);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const fx = x + 0.5, fy = y + 0.5, k = (y * W + x) * 3;
    const u = fx / W, v = fy / H;
    let r = mix(0.075, 0.012, v) + 0.03 * (1 - u), g = mix(0.02, 0.085, v * u + 0.2 * v), b = mix(0.19, 0.13, v);
    const n1 = fbm3(fx * 0.0042, fy * 0.0042, 3.3, 5), n2 = fbm3(fx * 0.0036 + 40, fy * 0.0036 + 7, 8.1, 5);
    const a1 = Math.pow(smooth(0.38, 0.78, n1), 1.6), a2 = Math.pow(smooth(0.40, 0.78, n2), 1.6);
    r = r * 0.35 + 0.075 * a1; g = g * 0.45 + 0.008 * a1 + 0.12 * a2; b = b * 0.45 + 0.17 * a1 + 0.13 * a2;
    const dx = fx - GX, dy = fy - GY, d = Math.sqrt(dx * dx + dy * dy), th = Math.atan2(dy, dx);
    const I1 = Math.pow(Math.max(0, rayAt(ray1, th) - 0.22), 1.35) * 1.9 / (1 + Math.pow(d / 290, 1.9));
    const I2 = rayAt(ray2, th) * 0.5 * Math.exp(-d / 700);
    const far = smooth(120, 760, d);
    const I = I1 + I2;
    r += I * mix(1.0, 0.95, far); g += I * mix(0.62, 0.08, far); b += I * mix(0.12, 0.50, far);
    // halo
    r += 1.1 * Math.exp(-d / 140) + 0.10 * Math.exp(-d / 380); g += 0.6 * Math.exp(-d / 120) + 0.005 * Math.exp(-d / 380); b += 0.18 * Math.exp(-d / 150) + 0.07 * Math.exp(-d / 380);
    // inner star seen through the opening
    const bx = fx - ballX, by = fy - ballY, bd = Math.sqrt(bx * bx + by * by);
    const ball = smooth(0.97 * R, 0.80 * R, bd), hot = smooth(0.95 * R, 0.55 * R, bd);
    const h1 = smooth(400, 170, d), h2 = smooth(215, 50, d); r += ball * (2.3 + 3.2 * h1 + 3 * h2); g += ball * (0.16 + 1.25 * h1 + 3.4 * h2); b += ball * (0.75 - 0.6 * h1 + 2.2 * h2);
    bg[k] = r; bg[k + 1] = g; bg[k + 2] = b;
  }
}
// stars
for (let i = 0; i < 620; i++) {
  const sx = rnd() * W, sy = rnd() * H, m = Math.pow(rnd(), 3.2), rad = 0.6 + 1.1 * m, I = 0.2 + 2.2 * m, tint = rnd();
  const cr = tint < 0.3 ? 1.0 : 0.75, cg = tint < 0.3 ? 0.7 : 0.9, cb = 1.0;
  addLine(bg, sx, sy, sx + 0.01, sy, rad, rad, I, I, cr, cg, cb);
  if (m > 0.93) { const L = 3 + 9 * m; addLine(bg, sx - L, sy, sx + L, sy, 0.7, 0.7, I * 0.4, I * 0.4, cr, cg, cb); addLine(bg, sx, sy - L, sx, sy + L, 0.7, 0.7, I * 0.4, I * 0.4, cr, cg, cb); }
}

// ---------- chunks ----------
const chunks = [];
function addChunk(cx, cy, size) {
  const n = 6 + Math.floor(rnd() * 3), rot = rnd() * 6.283, el = 0.6 + 0.3 * rnd(), ea = rnd() * 3.14;
  const vx = [], vy = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i + (rnd() - 0.5) * 0.55) / n * 6.283, rr = size * (0.68 + 0.32 * rnd());
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    const xr = x * Math.cos(ea) + y * Math.sin(ea), yr = (-x * Math.sin(ea) + y * Math.cos(ea)) * el;
    vx.push(cx + xr * Math.cos(ea) - yr * Math.sin(ea)); vy.push(cy + xr * Math.sin(ea) + yr * Math.cos(ea));
  }
  let ux = cx - GX, uy = cy - GY; const dist = Math.hypot(ux, uy) || 1; ux /= dist; uy /= dist;
  const kind = rnd();
  const alb = kind < 0.45 ? [0.03, 0.42, 0.58] : kind < 0.8 ? [0.14, 0.46, 0.22] : [0.60, 0.48, 0.26];
  const fa = rnd() * 3.14;
  chunks.push({ cx, cy, size, vx, vy, n, ux, uy, dist, alb, fx: Math.cos(fa), fy: Math.sin(fa) });
}
{
  const dir = (a, d) => [GX + Math.cos(a) * d, GY + Math.sin(a) * d];
  let p = dir(FAN - 0.62, 1.02 * R); addChunk(p[0], p[1], 50);
  p = dir(FAN + 0.50, 1.22 * R); addChunk(p[0], p[1], 42);
  p = dir(FAN - 0.08, 1.62 * R); addChunk(p[0], p[1], 31);
  p = dir(FAN + 1.25, 1.18 * R); addChunk(p[0], p[1], 27);
  p = dir(FAN - 1.45, 1.42 * R); addChunk(p[0], p[1], 30);
  let tries = 0;
  while (chunks.length < 21 && tries++ < 400) {
    const a = rnd() < 0.72 ? FAN + (rnd() + rnd() - 1) * 1.5 : rnd() * 6.283;
    const f = Math.pow(rnd(), 1.2), d = (0.62 + 1.75 * f) * R;
    p = dir(a, d);
    const size = Math.max(8, 36 * (1 - 0.6 * f) * (0.4 + 0.7 * rnd()));
    if (p[0] < 30 || p[0] > W - 30 || p[1] < 30 || p[1] > H - 30) continue;
    if (p[0] < 480 && p[1] > 760) continue;
    let ok = true;
    for (const c of chunks) if (Math.hypot(c.cx - p[0], c.cy - p[1]) < (c.size + size) * 1.5) ok = false;
    if (ok) addChunk(p[0], p[1], size);
  }
}
const TS = 32, TNX = W / TS; const tiles = []; for (let i = 0; i < TNX * TNX; i++) tiles.push([]);
chunks.forEach((c, ci) => {
  const x0 = Math.max(0, Math.floor((c.cx - c.size * 1.1 - 1) / TS)), x1 = Math.min(TNX - 1, Math.floor((c.cx + c.size * 1.1 + 1) / TS));
  const y0 = Math.max(0, Math.floor((c.cy - c.size * 1.1 - 1) / TS)), y1 = Math.min(TNX - 1, Math.floor((c.cy + c.size * 1.1 + 1) / TS));
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) tiles[ty * TNX + tx].push(ci);
  // motion streak pointing back toward the burst
  const L = Math.min(c.dist * 0.72, c.size * 4.2 + 80);
  const tx2 = c.cx - c.ux * L, ty2 = c.cy - c.uy * L;
  addLine(trail, c.cx, c.cy, tx2, ty2, c.size * 0.70, 1.5, 1.5, 0.0, 1.0, 0.12, 0.50);
  addLine(trail, c.cx, c.cy, tx2, ty2, c.size * 0.34, 0.8, 2.4, 0.0, 1.0, 0.70, 0.18);
});
function sdPoly(vx, vy, n, px, py) {
  let d = (px - vx[0]) * (px - vx[0]) + (py - vy[0]) * (py - vy[0]), s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const ex = vx[j] - vx[i], ey = vy[j] - vy[i], wx = px - vx[i], wy = py - vy[i];
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    const bx = wx - ex * t, by = wy - ey * t, dd = bx * bx + by * by;
    if (dd < d) d = dd;
    const c1 = py >= vy[i], c2 = py < vy[j], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

// sparks
for (let i = 0; i < 300; i++) {
  const a = rnd() < 0.75 ? FAN + (rnd() + rnd() - 1) * 1.7 : rnd() * 6.283;
  const f = rnd(), d = (0.45 + 2.5 * f * f) * R + 40 * rnd();
  const L = (7 + 34 * rnd()) * (0.6 + f), w = 0.8 + 1.1 * rnd() * rnd(), I = 0.5 + 1.5 * rnd();
  const ca = Math.cos(a), sa = Math.sin(a), x0 = GX + ca * d, y0 = GY + sa * d;
  if (x0 < 470 && y0 > 770) continue;
  const t = rnd();
  const cr = 1.0, cg = t < 0.6 ? 0.74 : 0.25, cb = t < 0.6 ? 0.25 : 0.6;
  addLine(over, x0, y0, x0 - ca * L, y0 - sa * L, w, 0.5, I, 0.0, cr, cg, cb);
}
// bloom over everything in the middle distance
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dx = x + 0.5 - GX, dy = y + 0.5 - GY, d2 = dx * dx + dy * dy, d = Math.sqrt(d2), k = (y * W + x) * 3;
  const a = Math.exp(-d2 / (74 * 74)), b = Math.exp(-d2 / (220 * 220)), c = Math.exp(-d / 330);
  const I = (rayAt(ray1, Math.atan2(dy, dx)) * 0.55) / (1 + Math.pow(d / 240, 2.2));
  over[k] += 0.55 * a + 0.13 * b + 0.03 * c + I * 0.32;
  over[k + 1] += 0.36 * a + 0.045 * b + 0.003 * c + I * 0.19;
  over[k + 2] += 0.12 * a + 0.025 * b + 0.02 * c + I * 0.04;
}

// ---------- planet sampling ----------
let sr = 0, sg = 0, sb = 0;
const LXs = -0.60, LYs = -0.52, LZs = 0.61;   // cool key light, upper left
function surface(qx, qy, isCap) {
  const gx = (qx + GR) / (2 * GR) * (GN - 1), gy = (qy + GR) / (2 * GR) * (GN - 1);
  const ix = clamp(gx | 0, 0, GN - 2), iy = clamp(gy | 0, 0, GN - 2), fx = gx - ix, fy = gy - iy, k = iy * GN + ix;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  const ar = gAr[k] * w00 + gAr[k + 1] * w10 + gAr[k + GN] * w01 + gAr[k + GN + 1] * w11;
  const ag = gAg[k] * w00 + gAg[k + 1] * w10 + gAg[k + GN] * w01 + gAg[k + GN + 1] * w11;
  const ab = gAb[k] * w00 + gAb[k + 1] * w10 + gAb[k + GN] * w01 + gAb[k + GN + 1] * w11;
  const v = gV[k] * w00 + gV[k + 1] * w10 + gV[k + GN] * w01 + gV[k + GN + 1] * w11;
  let nx = qx / R, ny = qy / R; const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  if (isCap) { const t = CA * nx - SA * ny; ny = SA * nx + CA * ny; nx = t; }
  const sx = EXx * nx + EYx * ny, sy = EXy * nx + EYy * ny;
  const diff = Math.max(0, sx * LXs + sy * LYs + nz * LZs);
  const fres = Math.pow(1 - nz, 3);
  const dz = Math.abs(qy - zigBase(clamp(qx, -R, R)));
  const warm = Math.exp(-dz / (0.30 * R)) * (0.30 + 0.45 * smooth(-R, R, qx));
  const li = 0.035 + 0.95 * diff * diff + 0.25 * diff;
  let r = ar * (li * 0.9 + warm * 1.2) + 0.008 + 0.16 * warm, g = ag * (li * 1.0 + warm * 0.42) + 0.005 + 0.035 * warm, b = ab * (li * 1.12 + warm * 0.12) + 0.022 + 0.03 * warm;
  r += fres * 0.20 * (0.25 + diff); g += fres * 0.65 * (0.25 + diff); b += fres * 1.0 * (0.25 + diff);
  const e1 = Math.exp(-v * v), e2 = Math.exp(-v * 0.42), e3 = Math.exp(-v * 0.115);
  r += 3.0 * e1 + 1.7 * e2 + 0.42 * e3; g += 2.4 * e1 + 0.80 * e2 + 0.02 * e3; b += 1.0 * e1 + 0.06 * e2 + 0.20 * e3;
  sr = r; sg = g; sb = b;
}
function samplePlanet(x, y) {
  const dx = x - PX, dy = y - PY, lx = dx * EXx + dy * EXy, ly = dx * EYx + dy * EYy;
  // lid (in front)
  const ux = lx - TX - PIVX, uy = ly - TY - PIVY;
  const qx = PIVX + CA * ux + SA * uy, qy = PIVY - SA * ux + CA * uy;
  if (qx * qx + qy * qy < R * R && qy < zig(qx)) { surface(qx, qy, true); return 1; }
  if (lx * lx + ly * ly < R * R && ly > zig(lx)) { surface(lx, ly, false); return 1; }
  return 0;
}

// ---------- chunk sampling ----------
function sampleChunks(x, y, list) {
  for (let q = 0; q < list.length; q++) {
    const c = chunks[list[q]];
    const dx = x - c.cx, dy = y - c.cy, dd = dx * dx + dy * dy;
    if (dd > c.size * c.size * 1.25) continue;
    const sd = sdPoly(c.vx, c.vy, c.n, x, y);
    if (sd >= 0) continue;
    const s = (dx * c.ux + dy * c.uy) / c.size;
    const lit = smooth(0.45, -0.85, s);
    const facet = (dx * c.fx + dy * c.fy) > 0 ? 1.0 : 0.62;
    const dl = Math.sqrt(dd) || 1;
    const rim = smooth(-c.size * 0.22, 0, sd) * Math.max(0, -(dx * c.ux + dy * c.uy) / dl);
    const near = 1 / (1 + Math.pow(c.dist / 420, 2));
    const L = lit * facet * (0.35 + 1.4 * near);
    sr = 0.010 + c.alb[0] * 0.5 * L + 0.95 * L + rim * 3.4 * (0.4 + near);
    sg = 0.006 + c.alb[1] * 0.5 * L + 0.40 * L + rim * 2.0 * (0.4 + near);
    sb = 0.028 + c.alb[2] * 0.4 * L + 0.07 * L + rim * 0.6 * (0.4 + near);
    return 1;
  }
  return 0;
}

// ---------- foreground: floating rock + astronaut ----------
const rockX = [58, 96, 150, 212, 282, 346, 402, 436, 408, 372, 338, 300, 262, 226, 182, 150, 112, 84];
const rockY = [892, 874, 870, 875, 872, 877, 869, 886, 916, 932, 978, 966, 1016, 986, 1002, 952, 942, 914];
const RKN = rockX.length;
const sdCaps = (px, py, ax, ay, bx, by, r) => { const ex = bx - ax, ey = by - ay, wx = px - ax, wy = py - ay; const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1); return Math.hypot(wx - ex * t, wy - ey * t) - r; };
const sdBox = (px, py, cx, cy, hx, hy, r) => { const qx = Math.abs(px - cx) - hx + r, qy = Math.abs(py - cy) - hy + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
function sdAstro(x, y) {
  const px = (x - ASTX) / ASTS, py = (y - ASTY) / ASTS;
  let d = Math.hypot(px - 2, py + 44) - 8.6;                         // helmet
  d = Math.min(d, sdBox(px, py, 0, -27.5, 7, 9.5, 3.5));             // torso
  d = Math.min(d, sdBox(px, py, -9.5, -29.5, 4, 8.5, 2));            // backpack
  d = Math.min(d, sdCaps(px, py, -3.2, -19, -4.6, -3.5, 3.4));       // legs
  d = Math.min(d, sdCaps(px, py, 3.2, -19, 5.2, -3.5, 3.4));
  d = Math.min(d, sdBox(px, py, -4.2, -1.8, 4.6, 2.4, 1.5));         // boots
  d = Math.min(d, sdBox(px, py, 6.4, -1.8, 4.8, 2.4, 1.5));
  d = Math.min(d, sdCaps(px, py, 6, -33.5, 11.5, -22, 2.7));         // arms
  d = Math.min(d, sdCaps(px, py, -6, -33.5, -4, -22, 2.7));
  return d * ASTS;
}
function sampleFront(x, y) {
  if (x > ASTX - 30 && x < ASTX + 30 && y > ASTY - 70 && y < ASTY + 4) {
    const d = sdAstro(x, y);
    if (d < 0) {
      let lx = GX - x, ly = GY - y; const ll = Math.hypot(lx, ly); lx /= ll; ly /= ll;
      const gx = sdAstro(x + 0.6, y) - d, gy = sdAstro(x, y + 0.6) - d, gl = Math.hypot(gx, gy) || 1;
      const nl = Math.max(0, (gx * lx + gy * ly) / gl);
      const rim = smooth(-3.4 * ASTS, -0.2, d) * nl;
      const px = (x - ASTX) / ASTS, py = (y - ASTY) / ASTS;
      const vis = smooth(0.6, -0.6, Math.hypot((px - 5.2) / 1.0, (py + 44.6) / 1.15) - 4.8);
      sr = 0.022 + rim * 3.6 + vis * 1.6; sg = 0.018 + rim * 2.1 + vis * 0.7; sb = 0.05 + rim * 0.9 + vis * 0.2;
      return 1;
    }
  }
  const d = sdPoly(rockX, rockY, RKN, x, y);
  if (d < 0) {
    let lx = GX - x, ly = GY - y; const ll = Math.hypot(lx, ly); lx /= ll; ly /= ll;
    const gx = sdPoly(rockX, rockY, RKN, x + 0.7, y) - d, gy = sdPoly(rockX, rockY, RKN, x, y + 0.7) - d, gl = Math.hypot(gx, gy) || 1;
    const nl = Math.max(0, (gx * lx + gy * ly) / gl);
    const rim = (smooth(-12, 0, d) * 0.8 + smooth(-3, 0, d) * 1.3) * nl;
    const n = fbm3(x * 0.035, y * 0.05, 4.4, 4);
    const top = smooth(940, 868, y) * (0.5 + n);
    sr = 0.014 + 0.05 * top + rim * 3.0; sg = 0.008 + 0.014 * top + rim * 1.3; sb = 0.035 + 0.08 * top + rim * 0.75;
    return 1;
  }
  return 0;
}

// ---------- compose ----------
const SS = 3;
const rgb = Buffer.alloc(W * H * 3);
const capTopY = 30, plX0 = PX - R * 1.5, plX1 = PX + R * 1.2, plY1 = PY + R + 3;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 3;
    let r = bg[k], g = bg[k + 1], b = bg[k + 2];
    if (x > plX0 && x < plX1 && y > capTopY && y < plY1) {
      let cr = 0, cg = 0, cb = 0, ca = 0;
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
        if (samplePlanet(x + (i + 0.5) / SS, y + (j + 0.5) / SS)) { cr += sr; cg += sg; cb += sb; ca++; }
      }
      if (ca) { const a = ca / (SS * SS); r = r * (1 - a) + cr / (SS * SS); g = g * (1 - a) + cg / (SS * SS); b = b * (1 - a) + cb / (SS * SS); }
    }
    r += trail[k]; g += trail[k + 1]; b += trail[k + 2];
    const list = tiles[(y >> 5) * TNX + (x >> 5)];
    if (list.length) {
      let cr = 0, cg = 0, cb = 0, ca = 0;
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
        if (sampleChunks(x + (i + 0.5) / SS, y + (j + 0.5) / SS, list)) { cr += sr; cg += sg; cb += sb; ca++; }
      }
      if (ca) { const a = ca / (SS * SS); r = r * (1 - a) + cr / (SS * SS); g = g * (1 - a) + cg / (SS * SS); b = b * (1 - a) + cb / (SS * SS); }
    }
    r += over[k]; g += over[k + 1]; b += over[k + 2];
    if (x > 40 && x < 450 && y > 790) {
      let cr = 0, cg = 0, cb = 0, ca = 0;
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
        if (sampleFront(x + (i + 0.5) / SS, y + (j + 0.5) / SS)) { cr += sr; cg += sg; cb += sb; ca++; }
      }
      if (ca) { const a = ca / (SS * SS); r = r * (1 - a) + cr / (SS * SS); g = g * (1 - a) + cg / (SS * SS); b = b * (1 - a) + cb / (SS * SS); }
    }
    // vignette, tone map, gamma
    const vx = (x - W / 2) / (W / 2), vy = (y - H / 2) / (H / 2);
    const vg = 1 - 0.45 * smooth(0.5, 1.42, Math.sqrt(vx * vx + vy * vy));
    r = 1 - Math.exp(-1.15 * r * vg); g = 1 - Math.exp(-1.15 * g * vg); b = 1 - Math.exp(-1.15 * b * vg);
    r = mix(r, r * r * (3 - 2 * r), 0.4); g = mix(g, g * g * (3 - 2 * g), 0.4); b = mix(b, b * b * (3 - 2 * b), 0.4);
    const l = 0.3 * r + 0.59 * g + 0.11 * b, sat = 1.18;
    r = clamp(l + (r - l) * sat, 0, 1); g = clamp(l + (g - l) * sat, 0, 1); b = clamp(l + (b - l) * sat, 0, 1);
    rgb[k] = Math.round(255 * Math.pow(r, 1 / 2.2)); rgb[k + 1] = Math.round(255 * Math.pow(g, 1 / 2.2)); rgb[k + 2] = Math.round(255 * Math.pow(b, 1 / 2.2));
  }
}

// ---------- PNG encoding ----------
const crcT = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcT[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(pix) {
  const stride = W * 3, raw = Buffer.alloc((stride + 1) * H), cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < H; y++) {
    const o = y * stride; let best = 0, bestS = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f]; let sum = 0;
      for (let i = 0; i < stride; i++) {
        const cur = pix[o + i], a = i >= 3 ? pix[o + i - 3] : 0, b = y > 0 ? pix[o + i - stride] : 0, c = i >= 3 && y > 0 ? pix[o + i - stride - 3] : 0;
        let p = 0;
        if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
        else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const v = (cur - p) & 255; out[i] = v; sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestS) { bestS = sum; best = f; }
    }
    raw[y * (stride + 1)] = best; cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
fs.mkdirSync(outDir, { recursive: true });
const png = encodePNG(rgb);
fs.writeFileSync(path.join(outDir, 'entry.png'), png);
console.log('wrote ' + path.join(outDir, 'entry.png') + ' (' + png.length + ' bytes)');

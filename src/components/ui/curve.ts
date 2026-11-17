// Smooth lines that never lie: a monotone cubic (Fritsch–Carlson) bends through every point without overshooting
// it, so a curve never shows a peak or dip the data does not have.
export type Pt = readonly [number, number];

export function smoothPath(p: readonly Pt[]): string {
  if (p.length < 2) return p.length ? `M${p[0][0]},${p[0][1]}` : "";
  if (p.length === 2) return `M${p[0][0]},${p[0][1]}L${p[1][0]},${p[1][1]}`;
  const n = p.length, d: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0] || 1));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let path = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (p[i + 1][0] - p[i][0]) / 3;
    path += `C${p[i][0] + h},${p[i][1] + m[i] * h} ${p[i + 1][0] - h},${p[i + 1][1] - m[i + 1] * h} ${p[i + 1][0]},${p[i + 1][1]}`;
  }
  return path;
}

/** Round tick values that bracket [lo, hi] in about `count` steps (0, 1 M, 2 M, 3 M rather than 0, 1,45 M, 2,9 M). */
export function niceTicks(lo: number, hi: number, count = 3): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / count, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return out;
}

/** A bar whose data end is rounded and whose base end is square: grows from the baseline, `down` for a negative bar. */
export function barPath(x: number, y: number, w: number, h: number, r: number, down = false): string {
  const k = Math.max(0, Math.min(r, w / 2, h));
  if (h <= 0) return "";
  return down
    ? `M${x},${y}H${x + w}V${y + h - k}Q${x + w},${y + h} ${x + w - k},${y + h}H${x + k}Q${x},${y + h} ${x},${y + h - k}Z`
    : `M${x},${y + h}V${y + k}Q${x},${y} ${x + k},${y}H${x + w - k}Q${x + w},${y} ${x + w},${y + k}V${y + h}Z`;
}

export interface Pt {
  x: number
  y: number
}

/**
 * Fruchterman–Reingold layout inside a w×h box, kept `pad` from the edges.
 * Deterministic: nodes start on a circle, so the same vault always draws the same graph.
 */
export function forceLayout(ids: string[], edges: [string, string][], w: number, h: number, pad = 30, iterations = 300): Map<string, Pt> {
  const n = ids.length
  const cx = w / 2
  const cy = h / 2
  const pos: Pt[] = ids.map((_, i) =>
    n === 1 ? { x: cx, y: cy } : { x: cx + (Math.cos((2 * Math.PI * i) / n) * w) / 3, y: cy + (Math.sin((2 * Math.PI * i) / n) * h) / 3 }
  )
  const at = new Map(ids.map((id, i) => [id, i]))
  const links = edges
    .map(([a, b]) => [at.get(a), at.get(b)] as const)
    .filter((l): l is readonly [number, number] => l[0] !== undefined && l[1] !== undefined && l[0] !== l[1])
  const k = 0.7 * Math.sqrt((w * h) / Math.max(n, 1))
  // Gravity scaled so the cloud settles at ~0.4 of the box whatever the node count (k shrinks as n grows).
  const gx = (2 * h) / w
  const gy = (2 * w) / h
  let temp = w / 10
  for (let it = 0; it < iterations; it++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }))
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x
        const dy = pos[i].y - pos[j].y
        const d = Math.max(Math.hypot(dx, dy), 0.01)
        const f = (k * k) / d / d
        disp[i].x += dx * f
        disp[i].y += dy * f
        disp[j].x -= dx * f
        disp[j].y -= dy * f
      }
    }
    for (const [a, b] of links) {
      const dx = pos[a].x - pos[b].x
      const dy = pos[a].y - pos[b].y
      const f = Math.hypot(dx, dy) / k
      disp[a].x -= dx * f
      disp[a].y -= dy * f
      disp[b].x += dx * f
      disp[b].y += dy * f
    }
    for (let i = 0; i < n; i++) {
      disp[i].x += (cx - pos[i].x) * gx
      disp[i].y += (cy - pos[i].y) * gy
      const d = Math.max(Math.hypot(disp[i].x, disp[i].y), 0.01)
      const step = Math.min(d, temp)
      pos[i].x = Math.min(w - pad, Math.max(pad, pos[i].x + (disp[i].x / d) * step))
      pos[i].y = Math.min(h - pad, Math.max(pad, pos[i].y + (disp[i].y / d) * step))
    }
    temp = Math.max(temp * 0.97, 0.5)
  }
  return new Map(ids.map((id, i) => [id, pos[i]]))
}

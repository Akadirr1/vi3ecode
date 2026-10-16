// Agent faces: 12 pixel portraits and 12 pixel glyphs, drawn procedurally (our own art, no image assets).
// An avatar string is 'portrait:<n>', 'glyph:<n>' or short text/emoji.

export const PORTRAIT_COUNT = 12
export const GLYPH_COUNT = 12

const SKIN = ['#f1c7a5', '#d9a07b', '#b97a56', '#8d5a3b', '#6b412a', '#e8b896']
const HAIR = ['#2b1d16', '#5a3a22', '#c26a2c', '#e5c07b', '#d7d7d7', '#7c3aed', '#1f2937', '#9b2c2c']
const SHIRT = ['#0f766e', '#1d4ed8', '#b45309', '#be185d', '#4d7c0f', '#6d28d9', '#334155', '#b91c1c']
// [skin, hair, hairStyle, shirt]; styles: 0 short, 1 long, 2 bun, 3 curly, 4 buzz, 5 side part
const PORTRAITS: [number, number, number, number][] = [
  [1, 0, 1, 0],
  [3, 0, 3, 1],
  [4, 4, 3, 7],
  [0, 4, 2, 5],
  [3, 1, 1, 3],
  [5, 2, 3, 2],
  [4, 6, 4, 2],
  [2, 0, 5, 4],
  [0, 5, 3, 5],
  [2, 1, 0, 6],
  [0, 4, 4, 1],
  [5, 2, 5, 6]
]

type Px = [number, number, string] // x, y, colour on a 16×16 grid

function portraitPixels(i: number): Px[] {
  const [s, h, style, sh] = PORTRAITS[((i % PORTRAIT_COUNT) + PORTRAIT_COUNT) % PORTRAIT_COUNT]
  const skin = SKIN[s]
  const hair = HAIR[h]
  const shirt = SHIRT[sh]
  const px: Px[] = []
  const fill = (x0: number, x1: number, y0: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px.push([x, y, c])
  }
  // shoulders, neck, head
  fill(3, 12, 14, 15, shirt)
  fill(4, 11, 13, 13, shirt)
  fill(7, 8, 11, 12, skin)
  fill(5, 10, 4, 10, skin)
  fill(6, 9, 11, 11, skin)
  // hair by style
  if (style === 0) {
    fill(5, 10, 3, 4, hair)
    fill(4, 4, 4, 7, hair)
    fill(11, 11, 4, 7, hair)
  } else if (style === 1) {
    fill(5, 10, 3, 4, hair)
    fill(4, 4, 4, 12, hair)
    fill(11, 11, 4, 12, hair)
    fill(3, 3, 7, 12, hair)
    fill(12, 12, 7, 12, hair)
  } else if (style === 2) {
    fill(5, 10, 3, 4, hair)
    fill(7, 8, 1, 2, hair)
    fill(4, 4, 4, 6, hair)
    fill(11, 11, 4, 6, hair)
  } else if (style === 3) {
    fill(4, 11, 2, 4, hair)
    fill(3, 3, 3, 8, hair)
    fill(12, 12, 3, 8, hair)
    for (const x of [4, 6, 8, 10]) px.push([x, 1, hair])
  } else if (style === 4) {
    fill(5, 10, 3, 3, hair)
  } else {
    fill(5, 10, 3, 4, hair)
    fill(4, 4, 4, 8, hair)
    fill(9, 11, 5, 5, hair)
  }
  // face
  px.push([6, 8, '#1a1a1a'], [9, 8, '#1a1a1a'], [7, 10, '#00000033'], [8, 10, '#00000033'])
  return px
}

// 12 left-half patterns (4 columns × 8 rows, bit 3 = leftmost); mirrored into an 8×8 glyph.
const GLYPHS = [
  [0b0011, 0b0111, 0b1101, 0b1111, 0b0111, 0b0010, 0b0101, 0b1010],
  [0b1001, 0b0101, 0b0111, 0b1101, 0b1111, 0b1111, 0b1010, 0b0011],
  [0b0001, 0b0011, 0b0111, 0b1101, 0b1111, 0b0101, 0b1000, 0b0100],
  [0b0110, 0b1111, 0b1011, 0b1111, 0b0110, 0b0110, 0b1001, 0b1000],
  [0b1000, 0b0100, 0b1111, 0b1011, 0b1111, 0b0111, 0b0100, 0b0110],
  [0b0011, 0b0111, 0b1111, 0b1001, 0b1111, 0b0110, 0b1010, 0b0001],
  [0b0000, 0b0111, 0b1111, 0b1101, 0b1111, 0b0111, 0b0101, 0b1001],
  [0b1100, 0b0110, 0b0111, 0b1101, 0b0111, 0b1111, 0b0010, 0b0101],
  [0b0101, 0b1111, 0b1011, 0b1111, 0b1111, 0b0110, 0b0101, 0b1001],
  [0b0010, 0b0111, 0b1101, 0b1111, 0b1010, 0b1111, 0b0001, 0b0010],
  [0b1111, 0b1001, 0b1111, 0b0110, 0b1111, 0b1001, 0b1001, 0b0110],
  [0b0001, 0b0111, 0b1111, 0b1011, 0b1111, 0b1010, 0b1010, 0b0101]
]

function glyphCells(i: number): [number, number][] {
  const rows = GLYPHS[((i % GLYPH_COUNT) + GLYPH_COUNT) % GLYPH_COUNT]
  const cells: [number, number][] = []
  rows.forEach((bits, y) => {
    for (let x = 0; x < 4; x++) {
      if (bits & (1 << (3 - x))) cells.push([x, y], [7 - x, y])
    }
  })
  return cells
}

export function Avatar({
  avatar,
  color,
  size = 28,
  status,
  title
}: {
  avatar: string
  color: string
  size?: number
  /** Small dot in the corner: working (brand) or idle (muted). */
  status?: 'working' | 'idle' | 'paused'
  title?: string
}) {
  const [kind, n] = avatar.split(':')
  const idx = Number(n)
  let face
  if (kind === 'portrait' && Number.isInteger(idx)) {
    face = (
      <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden>
        <rect width="16" height="16" rx="3" fill="#1d2433" />
        <rect y="10" width="16" height="6" fill={color} opacity="0.35" />
        {portraitPixels(idx).map(([x, y, c], k) => (
          <rect key={k} x={x} y={y} width="1" height="1" fill={c} />
        ))}
      </svg>
    )
  } else if (kind === 'glyph' && Number.isInteger(idx)) {
    face = (
      <svg viewBox="-1 -1 10 10" width={size} height={size} shapeRendering="crispEdges" aria-hidden>
        <rect x="-1" y="-1" width="10" height="10" rx="2" fill="#151a24" />
        {glyphCells(idx).map(([x, y], k) => (
          <rect key={k} x={x} y={y} width="1" height="1" fill={color} />
        ))}
      </svg>
    )
  } else {
    face = (
      <span className="avatar-text" style={{ width: size, height: size, background: color, fontSize: size * 0.45 }} aria-hidden>
        {avatar.slice(0, 2)}
      </span>
    )
  }
  return (
    <span className="avatar-wrap" style={{ width: size, height: size }} title={title} role={title ? 'img' : undefined} aria-label={title}>
      {face}
      {status ? <span className={`avatar-status ${status}`} /> : null}
    </span>
  )
}

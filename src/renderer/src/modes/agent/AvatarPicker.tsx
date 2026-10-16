import { Avatar, GLYPH_COUNT, PORTRAIT_COUNT } from '../../components/Avatar'
import { t } from '../../i18n'

export const SWATCHES = ['#34d399', '#60a5fa', '#fbbf24', '#a78bfa', '#f472b6', '#86efac', '#e0a458', '#f87171']

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/** Portrait and pixel-glyph tiles (glyphs tinted with the agent colour), plus the colour swatches. */
export function AvatarPicker({ avatar, color, onChange, swatches = true }: { avatar: string; color: string; onChange(p: { avatar?: string; color?: string }): void; swatches?: boolean }) {
  const tile = (value: string, label: string) => (
    <button key={value} type="button" className="ap-tile" aria-pressed={avatar === value} aria-label={label} title={label} onClick={() => onChange({ avatar: value })}>
      <Avatar avatar={value} color={color} size={38} />
    </button>
  )
  return (
    <div className="ap col">
      <div className="row">
        <span className="micro">{t('Avatar')}</span>
        <span className="grow" />
        <span className="micro faint">{t('pixel pool · {count}', { count: PORTRAIT_COUNT + GLYPH_COUNT })}</span>
      </div>
      <div className="micro ap-sub">{t('Portraits')}</div>
      <div className="ap-grid">{range(PORTRAIT_COUNT).map((i) => tile(`portrait:${i}`, t('Portrait {index}', { index: i + 1 })))}</div>
      <div className="micro ap-sub">{t('Pixel glyphs')}</div>
      <div className="ap-grid">{range(GLYPH_COUNT).map((i) => tile(`glyph:${i}`, t('Glyph {index}', { index: i + 1 })))}</div>
      {swatches ? <Swatches color={color} onChange={(c) => onChange({ color: c })} /> : null}
    </div>
  )
}

export function Swatches({ color, onChange }: { color: string; onChange(c: string): void }) {
  return (
    <div className="col ap-colors">
      <span className="micro">{t('Color')}</span>
      <div className="row">
        {SWATCHES.map((c) => (
          <button key={c} type="button" className="ap-swatch" style={{ background: c }} aria-pressed={color.toLowerCase() === c} aria-label={t('Color {hex}', { hex: c })} title={c} onClick={() => onChange(c)} />
        ))}
      </div>
    </div>
  )
}

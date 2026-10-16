// SKILL.md format and the AGENTS.md skills block. Pure: no fs, testable.

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
export const BLOCK_BEGIN = '<!-- vi3ecode:skills:begin -->'
export const BLOCK_END = '<!-- vi3ecode:skills:end -->'

export interface SkillDoc {
  name: string
  description: string
  body: string
}

/** Flat `key: value` frontmatter; quoted values allowed. The folder name, not the frontmatter, names the skill. */
export function parseSkillMd(md: string): { description: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  if (!m) return { description: '', body: md.trim() }
  let description = ''
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^description:\s*(.*)$/.exec(line)
    if (kv) description = unquote(kv[1].trim())
  }
  return { description, body: md.slice(m[0].length).replace(/^\r?\n/, '').trimEnd() }
}

function unquote(v: string): string {
  if (v.startsWith('"')) {
    try {
      return String(JSON.parse(v))
    } catch {
      return v.slice(1, -1)
    }
  }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replaceAll("''", "'")
  return v
}

/** The description is always double-quoted: a plain `a: b` value would break the engines' YAML parsers. */
export function serializeSkillMd(s: SkillDoc): string {
  return `---\nname: ${s.name}\ndescription: ${JSON.stringify(oneLine(s.description))}\n---\n\n${s.body.trim()}\n`
}

export const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * AGENTS.md with the skills block replaced (or appended, or removed when `skills` is empty).
 * Text outside the markers is never changed. Throws when the markers are broken rather than guess.
 */
export function withSkillsBlock(agentsMd: string, skills: SkillDoc[]): string {
  const begins = agentsMd.split(BLOCK_BEGIN).length - 1
  const ends = agentsMd.split(BLOCK_END).length - 1
  const b = agentsMd.indexOf(BLOCK_BEGIN)
  const e = agentsMd.indexOf(BLOCK_END)
  if (begins > 1 || ends > 1 || begins !== ends || e < b) {
    throw new Error('AGENTS.md has broken vi3ecode skills markers; fix or remove them by hand, then try again.')
  }
  const block = skills.length
    ? [
        BLOCK_BEGIN,
        '## Vi3ecode Skills',
        '',
        'Installed skill playbooks. Before doing one of these kinds of task, read the referenced file and follow it:',
        '',
        ...skills.map((s) => `- **${s.name}**: ${oneLine(s.description) || '(no description)'} — \`.vi3ecode/skills/${s.name}/SKILL.md\``),
        BLOCK_END
      ].join('\n')
    : ''
  if (begins) {
    const before = agentsMd.slice(0, b)
    const after = agentsMd.slice(e + BLOCK_END.length)
    if (block) return before + block + after
    // Removing: also drop the blank line we added in front of the block.
    return (before.replace(/\n\n$/, '\n') + after.replace(/^\n/, '')).replace(/^\n+$/, '')
  }
  if (!block) return agentsMd
  if (!agentsMd.trim()) return block + '\n'
  return agentsMd.replace(/\n*$/, '\n\n') + block + '\n'
}

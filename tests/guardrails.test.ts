import { describe, expect, it } from 'vitest'
import { matchGuardrail } from '../src/shared/guardrails'

const bash = (command: string) => matchGuardrail('Bash', { command })?.id ?? null

describe('guardrails', () => {
  it('flags destructive shell commands', () => {
    expect(bash('rm -rf node_modules')).toBe('file-delete')
    expect(bash('find . -name "*.log" -delete')).toBe('file-delete')
    expect(bash('git push --force origin main')).toBe('git-destructive')
    expect(bash('git reset --hard HEAD~3')).toBe('git-destructive')
    expect(bash('psql -c "DROP TABLE users"')).toBe('db-destructive')
    expect(bash('npx prisma migrate reset')).toBe('db-destructive')
    expect(bash('sudo rm /etc/hosts')).toBe('system-destructive')
    expect(bash('dd if=x.img of=/dev/disk2')).toBe('system-destructive')
    for (const c of ['git checkout -- .', 'git checkout .', 'git restore .', 'git restore --worktree src', 'git branch -D old', 'git push origin +main']) {
      expect(bash(c), c).toBe('git-destructive')
    }
  })
  it('lets ordinary work through', () => {
    for (const c of ['npm test', 'git status', 'git push origin feature', 'rm notes.txt', 'ls -la', 'git checkout main', 'git checkout -b feat', 'git restore --staged a.ts', 'git branch -d merged']) {
      expect(bash(c), c).toBeNull()
    }
  })
  it('checks database statements in any tool, other command rules only in shells', () => {
    expect(matchGuardrail('Write', { file_path: 'x.sql', content: 'DROP TABLE users;' })?.id).toBe('db-destructive')
    expect(matchGuardrail('Write', { file_path: 'a.sh', content: 'rm -rf /' })).toBeNull()
  })
})

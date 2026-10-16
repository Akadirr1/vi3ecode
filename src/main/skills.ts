import type { Skill } from '../shared/types'

// STUB — replaced by the skills store.
export const skillsApi = {
  async list(_projectId: string): Promise<Skill[]> {
    return []
  },
  async save(_projectId: string, skill: Omit<Skill, 'installed'>): Promise<Skill> {
    return { ...skill, installed: false }
  },
  async remove(_projectId: string, _name: string): Promise<void> {},
  async setInstalled(_projectId: string, _name: string, _installed: boolean): Promise<Skill[]> {
    return []
  }
}

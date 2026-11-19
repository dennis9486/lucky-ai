/** 用户可在设置里编辑的技能。 */
export interface ConfiguredSkill {
  id: string
  name: string
  description: string
  content: string
  enabled: boolean
}

export interface SaveConfiguredSkillInput {
  /** 已有技能的文件名（不含 .md）。改名时用来替换旧文件。 */
  id?: string
  name: string
  description: string
  content: string
  enabled?: boolean
}

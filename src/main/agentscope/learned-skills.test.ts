import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteSkill,
  listConfiguredSkills,
  readLearnedSkills,
  saveSkill,
  setSkillEnabled
} from './learned-skills.js'

describe('learned skills', () => {
  let dir: string
  const previous = process.env.LUCKY_SKILLS_DIR

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lucky-skills-'))
    process.env.LUCKY_SKILLS_DIR = dir
  })

  afterEach(async () => {
    if (previous === undefined) delete process.env.LUCKY_SKILLS_DIR
    else process.env.LUCKY_SKILLS_DIR = previous
    await rm(dir, { recursive: true, force: true })
  })

  it('saves, lists, disables and deletes a skill', async () => {
    await saveSkill({
      name: 'Release checklist',
      description: 'Ship a desktop build',
      content: 'Run the release workflow.'
    })

    const listed = await listConfiguredSkills()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      id: 'release-checklist',
      name: 'Release checklist',
      description: 'Ship a desktop build',
      enabled: true
    })
    expect(await readLearnedSkills()).toContain('Release checklist')

    await setSkillEnabled('release-checklist', false)
    expect(await readLearnedSkills()).toBe('')
    expect((await listConfiguredSkills())[0]?.enabled).toBe(false)

    await deleteSkill('release-checklist')
    expect(await listConfiguredSkills()).toEqual([])
  })

  it('keeps skills written before the enabled flag', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'legacy.md'), '# Legacy\n\n> old skill\n\nDo the old steps.\n', 'utf8')
    const listed = await listConfiguredSkills()
    expect(listed[0]).toMatchObject({ id: 'legacy', name: 'Legacy', enabled: true })
    expect(await readLearnedSkills()).toContain('Do the old steps.')
  })

  it('rejects a skill id that escapes the skills directory', async () => {
    await expect(deleteSkill('../secret')).rejects.toThrow('技能标识无效')
    expect(await readFile(join(dir, '..', 'secret.md')).catch(() => 'missing')).toBe('missing')
  })
})

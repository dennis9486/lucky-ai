import { describe, expect, it } from 'vitest'
import {
  basename,
  buildReferenceToken,
  detectMention,
  parseMentionSegments,
  rankFileResults,
  type RankableFile
} from './mention.js'

describe('detectMention boundary', () => {
  it('triggers when @ is at line start', () => {
    const state = detectMention('@foo', 4)
    expect(state).not.toBeNull()
    expect(state?.query).toBe('foo')
    expect(state?.kind).toBeNull()
  })

  it('triggers after whitespace', () => {
    expect(detectMention('修改一下 @Chat', 7)).not.toBeNull()
  })

  it('triggers after a CJK character (no space)', () => {
    const state = detectMention('文档@Chat', 7)
    expect(state).not.toBeNull()
    expect(state?.query).toBe('Chat')
  })

  it('does NOT trigger inside an email address', () => {
    expect(detectMention('ping user@example', 17)).toBeNull()
  })

  it('does NOT trigger when @ follows a path/identifier char', () => {
    expect(detectMention('a.b@c', 5)).toBeNull()
  })

  it('opens the file picker when @file is selected', () => {
    const state = detectMention('@file ', 6)
    expect(state?.kind).toBe('file')
  })

  it('keeps the file picker open while typing a basename query', () => {
    const text = '@file partial'
    const state = detectMention(text, text.length)
    expect(state?.kind).toBe('file')
  })

  it('does NOT reopen after a completed @file reference with trailing text', () => {
    const text = '@file src/a/agent.ts 的注释'
    expect(detectMention(text, text.length)).toBeNull()
  })

  it('does NOT reopen after a completed @file reference at end of path', () => {
    expect(detectMention('@file src/a/agent.ts', 20)).toBeNull()
  })

  it('does NOT reopen after a completed absolute @file reference', () => {
    const text = '@file /Users/dev/doc.md 这篇文章讲了什么'
    expect(detectMention(text, text.length)).toBeNull()
  })
})

describe('rankFileResults', () => {
  const files: RankableFile[] = [
    { name: 'MyChatWidget.vue', path: 'MyChatWidget.vue' }, // substring (mid-word)
    { name: 'readme.md', path: 'docs/chat/readme.md' },     // path-only match
    { name: 'ChatView.vue', path: 'ChatView.vue' },         // name prefix
    { name: 'app.chat.ts', path: 'app.chat.ts' }            // word-boundary in name
  ]

  it('ranks prefix > word-boundary > substring > path-only matches', () => {
    const ranked = rankFileResults(files, 'chat')
    expect(ranked.map((f) => f.name)).toEqual([
      'ChatView.vue',
      'app.chat.ts',
      'MyChatWidget.vue',
      'readme.md'
    ])
  })

  it('returns the original order for an empty query', () => {
    const ranked = rankFileResults(files, '')
    expect(ranked.map((f) => f.name)).toEqual(files.map((f) => f.name))
  })

  it('prefers shallower paths on score ties', () => {
    const tied: RankableFile[] = [
      { name: 'index.ts', path: 'a/b/c/index.ts' },
      { name: 'index.ts', path: 'index.ts' }
    ]
    expect(rankFileResults(tied, 'index')[0]?.path).toBe('index.ts')
  })
})

describe('reference token round-trip', () => {
  it('builds a path-carrying token', () => {
    expect(buildReferenceToken('file', 'src/main/agent.ts')).toBe('@file src/main/agent.ts')
    expect(buildReferenceToken('folder', 'src/main')).toBe('@folder src/main')
  })

  it('basename takes the last path segment', () => {
    expect(basename('src/main/agentscope/agent.ts')).toBe('agent.ts')
    expect(basename('agent.ts')).toBe('agent.ts')
    expect(basename('src\\win\\path.ts')).toBe('path.ts')
  })

  it('parses text into text and reference segments', () => {
    const segments = parseMentionSegments('修复 @file src/a/agent.ts 的注释')
    expect(segments).toEqual([
      { type: 'text', value: '修复 ' },
      { type: 'reference', kind: 'file', path: 'src/a/agent.ts', name: 'agent.ts' },
      { type: 'text', value: ' 的注释' }
    ])
  })

  it('disambiguates same-named files by full path', () => {
    const segments = parseMentionSegments('@file a/agent.ts @file b/agent.ts')
    const refs = segments.filter((s) => s.type === 'reference')
    expect(refs).toHaveLength(2)
    expect(refs[0]).toMatchObject({ path: 'a/agent.ts', name: 'agent.ts' })
    expect(refs[1]).toMatchObject({ path: 'b/agent.ts', name: 'agent.ts' })
  })

  it('leaves plain text without tokens untouched', () => {
    expect(parseMentionSegments('hello world')).toEqual([{ type: 'text', value: 'hello world' }])
  })
})

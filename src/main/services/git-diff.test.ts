import { describe, expect, it } from 'vitest'
import { parseUnifiedDiffHunks, suggestCommitMessageFromStatus } from './git-diff.js'

describe('git diff helpers', () => {
  it('parses unified diff hunks with line numbers', () => {
    const hunks = parseUnifiedDiffHunks(`diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 export { a }
`)

    expect(hunks).toHaveLength(1)
    expect(hunks[0]?.additions).toBe(2)
    expect(hunks[0]?.deletions).toBe(1)
    expect(hunks[0]?.lines.find((line) => line.type === 'add')?.newLine).toBe(2)
  })

  it('suggests a concise fallback commit message', () => {
    const message = suggestCommitMessageFromStatus([
      { path: 'src/App.vue', index: ' ', workingTree: 'M' },
      { path: 'src/main.ts', index: ' ', workingTree: 'M' }
    ])

    expect(message).toBe('ui: update 2 files')
  })
})

import { describe, expect, it } from 'vitest'
import { parsePlistXml } from './plist.js'

describe('parsePlistXml', () => {
  it('parses a minimal grammar dict', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>name</key>
  <string>Ruby</string>
  <key>scopeName</key>
  <string>source.ruby</string>
  <key>patterns</key>
  <array>
    <dict>
      <key>match</key>
      <string>\\bclass\\b</string>
      <key>name</key>
      <string>keyword.control.class.ruby</string>
    </dict>
  </array>
</dict>
</plist>`

    const parsed = parsePlistXml(xml) as Record<string, unknown>
    expect(parsed.name).toBe('Ruby')
    expect(parsed.scopeName).toBe('source.ruby')
    expect(Array.isArray(parsed.patterns)).toBe(true)
  })
})

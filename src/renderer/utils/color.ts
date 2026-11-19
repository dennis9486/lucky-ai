export function parseHex(hex: string): [number, number, number] | null {
  const normalized = hex.trim().replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null
  const value = parseInt(normalized, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
    .join('')}`
}

export function mixHex(colorA: string, colorB: string, weight: number): string {
  const a = parseHex(colorA)
  const b = parseHex(colorB)
  if (!a || !b) return colorA
  const t = Math.max(0, Math.min(1, weight))
  return toHex(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  )
}

export function normalizeHex(value: string, fallback: string): string {
  const parsed = parseHex(value)
  if (!parsed) return fallback
  return toHex(parsed[0], parsed[1], parsed[2])
}

function channelLuminance(channel: number): number {
  const s = channel / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0.5
  const [r, g, b] = rgb
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

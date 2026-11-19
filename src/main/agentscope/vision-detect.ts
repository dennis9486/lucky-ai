/**
 * vision-detect.ts — 判断某模型是否可接收多模态图片内容（纯函数、零依赖、可单测）。
 *
 * 目标是「不静默丢图」：把图片替换成占位文本让用户以为发送了，是最差的体验。
 * 但自动模式也不应把图片盲发给文本模型；未知模型按不支持处理，用户可在配置里显式开启。
 */

/** 明确的纯文本 / 非视觉模型族——即便走 OpenAI 兼容端点也不该塞图片。 */
export const TEXT_ONLY_MODEL_PATTERNS: RegExp[] = [
  /deepseek/, // deepseek-chat / reasoner / coder
  /\bglm-?5(?:\.\d+)?\b(?!\s*v|[-_.]?v)/,
  /gpt-3\.5/,
  /text-embedding|\bembed\b|\bbge\b|\bm3e\b|\bgte\b/,
  /\bwhisper\b|\btts\b|\breranker\b/
]

/** 已知视觉模型族（覆盖常见命名；无法穷举，故配合“云端默认支持”的兜底）。 */
export const VISION_MODEL_PATTERNS: RegExp[] = [
  /gpt-4o/, /gpt-4\.1/, /\bo[134]\b/,
  /vision/, /-vl\b|\bvl\b/, /llava/, /bakllava/, /minicpm-v/, /moondream/,
  /llama-?3\.2-vision/, /qwen[\w.-]*-?vl/, /pixtral/, /gemini/, /claude/,
  /glm-?[\d.]*v/, /internvl/, /step-?1v/, /yi-vl/, /molmo/, /phi-3\.5-vision/, /grok-?\d?-?vision/
]

/**
 * @param signature  `${name} ${baseUrl} ${model}`.toLowerCase()
 * @param providerType 'openai' | 'lmstudio' | 'ollama' | ...
 *
 * 策略：
 * 1. 已知纯文本 → false；
 * 2. 已知视觉 → true；
 * 3. 兜底：未知模型一律 false。若供应商支持图片但命名无法识别，请在配置里把“多模态”
 *    显式设为“开启”，避免自动模式制造 400 content.type 这类不可恢复错误。
 */
export function detectVisionSupport(signature: string, _providerType: string): boolean {
  const sig = signature.toLowerCase()
  if (TEXT_ONLY_MODEL_PATTERNS.some((pattern) => pattern.test(sig))) return false
  if (VISION_MODEL_PATTERNS.some((pattern) => pattern.test(sig))) return true
  return false
}

/**
 * Lucky — Bootstrap Environment Variable Loader
 *
 * 在 app.whenReady() 之前加载 .env 文件到 process.env 中。
 * dotenv 不会覆盖已有的 process.env 变量（第一个值优先）。
 *
 * 加载优先级（低 → 高，后加载的可以覆盖先加载的）：
 *   1. .env                        — 默认值，提交至版本库
 *   2. .env.{NODE_ENV}             — 环境特定覆盖，如 .env.development
 *   3. .env.local                  — 本地密钥/覆盖，不提交至版本库
 *
 * 生产构建（electron-builder）不包含 .env 文件，因此生产环境
 * 仅读取系统环境变量，所有值回退到 env.ts 中的默认值。
 */

import dotenv from 'dotenv'
import { expand } from 'dotenv-expand'
import { resolve } from 'node:path'

function loadEnvFile(filePath: string): void {
  const result = dotenv.config({ path: filePath })
  if (result.parsed) {
    expand(result)
  }
  // dotenv silently ignores missing files — that's fine
}

// 从低到高优先级依次加载
const envDir = process.cwd()
const nodeEnv = process.env.NODE_ENV ?? 'development'

loadEnvFile(resolve(envDir, '.env'))
if (nodeEnv) {
  loadEnvFile(resolve(envDir, `.env.${nodeEnv}`))
}
loadEnvFile(resolve(envDir, '.env.local'))

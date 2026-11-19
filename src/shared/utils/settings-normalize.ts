import type { GeneralAppSettings } from '../types/ipc.js'
import { DEFAULT_GENERAL_APP_SETTINGS } from '../types/ipc.js'
import { normalizeBrowserHomepage } from './browser-url.js'

/**
 * Backward-compatible normalizer for settings.json.
 * Keep this flat until a stored-settings migration exists; use typed groups at call sites.
 */
export function normalizeGeneralSettings(input?: Partial<GeneralAppSettings> | null): GeneralAppSettings {
  const merged = { ...DEFAULT_GENERAL_APP_SETTINGS, ...(input ?? {}) }
  return {
    ...merged,
    browserHomepage: normalizeBrowserHomepage(merged.browserHomepage),
    browserSearchEngine: merged.browserSearchEngine ?? DEFAULT_GENERAL_APP_SETTINGS.browserSearchEngine
  }
}


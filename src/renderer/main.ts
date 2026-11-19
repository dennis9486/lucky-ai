import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createLogger } from '../shared/utils/log.js'
import App from './App.vue'
import { i18n } from './i18n/index.js'
import './styles.css'

const logger = createLogger('renderer/app')

window.addEventListener('error', (event) => {
  logger.error('window error', {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    error: event.error
  })
  window.luckyAI?.app?.reportError?.({
    kind: 'error',
    message: event.message || String(event.error ?? 'unknown error'),
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error instanceof Error ? event.error.stack : undefined
  })
})

window.addEventListener('unhandledrejection', (event) => {
  logger.error('unhandled promise rejection', {
    reason: event.reason
  })
  const reason = event.reason
  window.luckyAI?.app?.reportError?.({
    kind: 'unhandledrejection',
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  })
})

createApp(App).use(createPinia()).use(i18n).mount('#app')

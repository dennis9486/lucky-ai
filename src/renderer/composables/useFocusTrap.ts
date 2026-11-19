import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

interface FocusTrapOptions {
  /** 覆写激活时的初始聚焦目标；返回 null/undefined 则回退到第一个可聚焦元素。 */
  initialFocus?: () => HTMLElement | null | undefined
}

/**
 * 模态浮层的键盘可达性基元（focus trap）：
 * - 激活时记住触发者、把焦点移入浮层（可指定初始目标）；
 * - Tab / Shift+Tab 在浮层内循环，不会漏到背景内容；
 * - 关闭/卸载时把焦点还给触发者。
 *
 * Esc 关闭仍由各组件按自身语义处理（此处只负责焦点，不吞按键）。
 */
export function useFocusTrap(
  container: Ref<HTMLElement | null>,
  active: Ref<boolean>,
  options: FocusTrapOptions = {}
): void {
  let previouslyFocused: HTMLElement | null = null

  function focusables(): HTMLElement[] {
    const root = container.value
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    )
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return
    const root = container.value
    if (!root) return
    const items = focusables()
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0]!
    const last = items[items.length - 1]!
    const activeEl = document.activeElement as HTMLElement | null
    const inside = root.contains(activeEl)
    if (event.shiftKey) {
      if (!inside || activeEl === first) {
        event.preventDefault()
        last.focus()
      }
    } else if (!inside || activeEl === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function restoreFocus(): void {
    previouslyFocused?.focus?.()
    previouslyFocused = null
  }

  watch(
    active,
    async (on) => {
      if (on) {
        previouslyFocused = document.activeElement as HTMLElement | null
        await nextTick()
        const target = options.initialFocus?.() ?? focusables()[0] ?? container.value
        target?.focus?.()
        document.addEventListener('keydown', onKeydown, true)
      } else {
        document.removeEventListener('keydown', onKeydown, true)
        restoreFocus()
      }
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown, true)
    if (active.value) restoreFocus()
  })
}

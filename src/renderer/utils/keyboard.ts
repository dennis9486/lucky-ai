export function isImeComposingEnter(event: KeyboardEvent): boolean {
  const key = event.key
  return (key === 'Enter' || key === 'Process') && (event.isComposing || event.keyCode === 229)
}

/** VS Code-style dirty tracking via Monaco model version ids. */
export function isTabDirty(pristineVersionId: number | null, currentVersionId: number): boolean {
  if (pristineVersionId === null) return false
  return currentVersionId !== pristineVersionId
}

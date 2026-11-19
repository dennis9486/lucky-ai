export const APP_MENU_COMMANDS = [
  'new-chat',
  'quick-chat',
  'save-current-file',
  'command-palette',
  'focus-composer',
  'open-settings',
  'stop-agent',
  'archive-chat',
  'toggle-sidebar',
  'toggle-terminal',
  'toggle-right-panel',
  'show-chat',
  'show-code',
  'show-browser',
  'show-scheduled',
  'new-window'
] as const

export type AppMenuCommand = (typeof APP_MENU_COMMANDS)[number]

const APP_MENU_COMMAND_SET = new Set<string>(APP_MENU_COMMANDS)

export function isAppMenuCommand(command: string): command is AppMenuCommand {
  return APP_MENU_COMMAND_SET.has(command)
}

import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { IPC_CHANNELS } from '../shared/constants/ipc-channels.js'
import type { AppMenuCommand } from '../shared/types/menu.js'
import { createNewWindow } from './window.js'

interface ApplicationMenuOptions {
  professionalMode: boolean
}

function sendMenuCommand(command: AppMenuCommand): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send(IPC_CHANNELS.APP_MENU_COMMAND, command)
}

function commandItem(
  label: string,
  command: AppMenuCommand,
  accelerator?: string
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: () => sendMenuCommand(command)
  }
}

function separator(): MenuItemConstructorOptions {
  return { type: 'separator' }
}

function buildAppMenu(): MenuItemConstructorOptions {
  return {
    label: app.name,
    submenu: [
      { role: 'about' },
      separator(),
      commandItem('Preferences...', 'open-settings', 'CommandOrControl+,'),
      separator(),
      { role: 'services' },
      separator(),
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      separator(),
      { role: 'quit' }
    ]
  }
}

function buildFileMenu(options: ApplicationMenuOptions): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [
    commandItem('New Chat', 'new-chat', 'CommandOrControl+N'),
    commandItem('Quick Chat', 'quick-chat', 'CommandOrControl+Shift+L'),
    {
      label: 'New Window',
      accelerator: 'CommandOrControl+Shift+N',
      click: () => {
        createNewWindow()
      }
    }
  ]

  if (options.professionalMode) {
    submenu.push(separator(), commandItem('Save', 'save-current-file', 'CommandOrControl+S'))
  }

  submenu.push(separator(), { role: 'close' })

  return {
    label: 'File',
    submenu
  }
}

function buildEditMenu(): MenuItemConstructorOptions {
  return {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      separator(),
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      separator(),
      { role: 'selectAll' }
    ]
  }
}

function buildSelectionMenu(): MenuItemConstructorOptions {
  return {
    label: 'Selection',
    submenu: [
      { role: 'selectAll' },
      separator(),
      { label: 'Expand Selection', enabled: false },
      { label: 'Shrink Selection', enabled: false }
    ]
  }
}

function buildViewMenu(options: ApplicationMenuOptions): MenuItemConstructorOptions {
  const workspaceItems: MenuItemConstructorOptions[] = options.professionalMode
    ? [
        separator(),
        commandItem('Show Code', 'show-code'),
        commandItem('Show Browser', 'show-browser'),
        separator(),
        commandItem('Toggle Right Panel', 'toggle-right-panel', 'CommandOrControl+Shift+B'),
        commandItem('Toggle Terminal', 'toggle-terminal', 'CommandOrControl+`')
      ]
    : []

  return {
    label: 'View',
    submenu: [
      commandItem('Command Palette...', 'command-palette', 'CommandOrControl+P'),
      separator(),
      commandItem('Show Chat', 'show-chat'),
      ...workspaceItems,
      commandItem('Toggle Sidebar', 'toggle-sidebar', 'CommandOrControl+B'),
      separator(),
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      separator(),
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      separator(),
      { role: 'togglefullscreen' }
    ]
  }
}

function buildGoMenu(options: ApplicationMenuOptions): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [
    commandItem('Focus Composer', 'focus-composer', 'CommandOrControl+L'),
    commandItem('Go to Chat', 'show-chat')
  ]

  if (options.professionalMode) {
    submenu.push(commandItem('Go to Code', 'show-code'), commandItem('Go to Browser', 'show-browser'))
  }

  return {
    label: 'Go',
    submenu
  }
}

function buildRunMenu(): MenuItemConstructorOptions {
  return {
    label: 'Run',
    submenu: [
      commandItem('Stop Agent', 'stop-agent', 'Esc'),
      separator(),
      { label: 'Run Active File', enabled: false },
      { label: 'Debug Active File', enabled: false }
    ]
  }
}

function buildTerminalMenu(): MenuItemConstructorOptions {
  return {
    label: 'Terminal',
    submenu: [
      commandItem('Toggle Terminal', 'toggle-terminal', 'CommandOrControl+`'),
      separator(),
      { label: 'New Terminal', enabled: false },
      { label: 'Kill Terminal', enabled: false }
    ]
  }
}

function buildWindowMenu(): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [
    { role: 'minimize' },
    { role: 'zoom' },
    separator(),
    {
      label: 'New Window',
      accelerator: 'CommandOrControl+Shift+N',
      click: () => {
        createNewWindow()
      }
    }
  ]

  if (process.platform === 'darwin') {
    submenu.push(separator(), { role: 'front' })
  }

  return { label: 'Window', submenu }
}

function buildHelpMenu(): MenuItemConstructorOptions {
  return {
    role: 'help',
    submenu: [
      {
        label: 'Lucky Documentation',
        click: () => {
          void shell.openExternal('https://github.com')
        }
      }
    ]
  }
}

export function installApplicationMenu(options: ApplicationMenuOptions = { professionalMode: false }): void {
  app.setName('Lucky')
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [buildAppMenu()] : []),
    buildFileMenu(options),
    buildEditMenu(),
    ...(options.professionalMode ? [buildSelectionMenu()] : []),
    buildViewMenu(options),
    buildGoMenu(options),
    ...(options.professionalMode ? [buildRunMenu(), buildTerminalMenu()] : []),
    buildWindowMenu(),
    buildHelpMenu()
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

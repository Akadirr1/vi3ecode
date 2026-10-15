import { BrowserWindow } from 'electron'

/** Push an event to every renderer window. */
export function emit(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args)
}

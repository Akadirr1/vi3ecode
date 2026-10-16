import { BrowserWindow, Notification } from 'electron'

/** Push an event to every renderer window. */
export function emit(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args)
}

/** OS notification when the app is in the background (an agent needs approval, a thread finished). */
export function notify(title: string, body: string): void {
  if (BrowserWindow.getAllWindows().some((w) => w.isFocused()) || !Notification.isSupported()) return
  const n = new Notification({ title, body: body.slice(0, 200) })
  n.on('click', () => BrowserWindow.getAllWindows()[0]?.show())
  n.show()
}

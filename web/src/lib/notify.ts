// Desktop notification when an agent needs you. Uses the Web Notifications API,
// which works in the Tauri webview and the browser. Permission is requested
// lazily on the first interaction.

let permission: NotificationPermission | 'unsupported' =
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission

export const ensureNotifyPermission = (): void => {
  if (permission === 'default') void Notification.requestPermission().then(p => (permission = p))
}

export const notify = (title: string, body: string): void => {
  if (permission !== 'granted') return
  try {
    new Notification(title, { body, tag: title })
  } catch {
    // notifications unavailable — silent
  }
}

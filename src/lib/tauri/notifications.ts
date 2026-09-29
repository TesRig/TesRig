import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let permissionPromise: Promise<boolean> | null = null;

export function ensureNotificationPermission() {
  if (!isTauri()) return Promise.resolve(false);
  permissionPromise ??= isPermissionGranted().then(async (granted) => {
    if (granted) return true;
    return (await requestPermission()) === "granted";
  });
  return permissionPromise.catch(() => false);
}

export async function notifyIfAppIsBackground(title: string, body: string) {
  if (!isTauri()) return;
  const appWindow = getCurrentWindow();
  const [focused, minimized] = await Promise.all([
    appWindow.isFocused().catch(() => true),
    appWindow.isMinimized().catch(() => false),
  ]);
  if (focused && !minimized) return;
  if (!(await ensureNotificationPermission())) return;
  sendNotification({ title, body });
}

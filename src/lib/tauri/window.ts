import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function setAppWindowTitle(title: string) {
  document.title = title;
  if (!isTauri()) return;
  void getCurrentWindow()
    .setTitle(title)
    .catch(() => undefined);
}

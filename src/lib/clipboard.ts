import { api, isTauriRuntime } from './ipc';

/**
 * The WebView's `navigator.clipboard` is not wired to the desktop clipboard in
 * a packaged Tauri window, and the backend must know what it wrote: it records
 * a SHA-256 fingerprint, schedules the auto-clear and wipes the value when the
 * vault locks, the window minimizes or the app exits.
 *
 * So a recovery key is copied through `copy_recovery_key`, which accepts only
 * recovery-key shaped text. The browser fallback exists for the UI preview and
 * is never part of a release build.
 *
 * Returns the auto-clear delay in seconds, or null outside the desktop runtime.
 */
export async function copyRecoveryKey(value: string): Promise<number | null> {
  if (isTauriRuntime()) {
    const response = await api.copyRecoveryKey(value);
    return response.clearsInSeconds;
  }
  await navigator.clipboard.writeText(value);
  return null;
}

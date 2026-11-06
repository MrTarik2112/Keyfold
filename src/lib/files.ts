import { save } from '@tauri-apps/plugin-dialog';

import { api, isTauriRuntime } from './ipc';

/**
 * Save a recovery key to a file the user picks. The webview sends only the key:
 * the backend composes the document and validates that the value really is a
 * recovery key, so this call can never write arbitrary content to disk.
 * Returns false if the save dialog was cancelled.
 */
export async function saveRecoveryKeyFile(key: string): Promise<boolean> {
  if (isTauriRuntime()) {
    const path = await save({
      defaultPath: 'keyfold-recovery-key.txt',
      filters: [{ name: 'Text file', extensions: ['txt'] }],
    });
    if (!path) return false;
    await api.saveRecoveryKey(path, key);
    return true;
  }

  // Browser-only convenience for the UI preview; releases never take this path.
  const contents = `Keyfold recovery key\n\n${key}\n\nKeep this file somewhere safe and offline.\nIf you lose both master passwords and this recovery key, your data cannot be recovered.\n`;
  const blob = new Blob([contents], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'keyfold-recovery-key.txt';
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

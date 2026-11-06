import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type {
  AppInfo,
  CopyResponse,
  CreateVaultResponse,
  FolderDraft,
  FolderPatch,
  KeyDraft,
  KeyPatch,
  KdfParams,
  MoveKeyInput,
  SearchHit,
  SessionStatus,
  Settings,
  Tier,
  TierView,
  WorkspaceView,
} from './types';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Every backend call goes through here. Outside the desktop runtime the UI
 * runs against an in-memory preview harness so the interface can be reviewed
 * in a browser; that harness is dev-only and is never part of a release build.
 */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriRuntime()) {
    return invoke<T>(command, args);
  }
  if (import.meta.env.DEV) {
    const { previewInvoke } = await import('./preview-backend');
    return previewInvoke(command, args) as Promise<T>;
  }
  throw new Error('Keyfold needs to run as the desktop app.');
}

export const api = {
  vaultExists: () => call<boolean>('vault_exists'),
  appInfo: () => call<AppInfo>('app_info'),
  createVault: (masterPassword: string, criticalPassword: string) =>
    call<CreateVaultResponse>('create_vault', { masterPassword, criticalPassword }),
  unlock: (password: string) => call<WorkspaceView>('unlock', { password }),
  unlockCritical: (password: string) => call<WorkspaceView>('unlock_critical', { password }),
  unlockRecovery: (recoveryKey: string) => call<WorkspaceView>('unlock_recovery', { recoveryKey }),
  lock: () => call<void>('lock'),
  lockCritical: () => call<void>('lock_critical'),
  sessionStatus: () => call<SessionStatus>('session_status'),
  touch: () => call<void>('touch'),
  touchCritical: () => call<void>('touch_critical'),
  workspace: () => call<WorkspaceView>('get_workspace'),
  listTree: (tier: Tier) => call<TierView>('list_tree', { tier }),
  getSecret: (entryId: string) => call<string>('get_secret', { entryId }),
  copySecret: (entryId: string) => call<CopyResponse>('copy_secret', { entryId }),
  createFolder: (input: FolderDraft) => call<TierView>('create_folder', { input }),
  updateFolder: (input: FolderPatch) => call<TierView>('update_folder', { input }),
  deleteFolder: (id: string, confirmName: string) =>
    call<TierView>('delete_folder', { input: { id, confirmName } }),
  createKey: (input: KeyDraft) => call<unknown>('create_key', { input }),
  updateKey: (input: KeyPatch) => call<unknown>('update_key', { input }),
  moveKey: (input: MoveKeyInput) => call<WorkspaceView>('move_key', { input }),
  deleteKey: (entryId: string) => call<WorkspaceView>('delete_key', { entryId }),
  reorderFolders: (tier: Tier, folderIds: string[]) =>
    call<TierView>('reorder_folders', { tier, folderIds }),
  search: (query: string) => call<SearchHit[]>('search', { query }),
  getSettings: () => call<Settings>('get_settings'),
  setSettings: (settings: Settings) => call<Settings>('set_settings', { settings }),
  changeMaster: (currentPassword: string, newPassword: string) =>
    call<void>('change_master', { currentPassword, newPassword }),
  changeCritical: (currentPassword: string, newPassword: string) =>
    call<void>('change_critical', { currentPassword, newPassword }),
  regenerateRecovery: (masterPassword: string, criticalPassword: string) =>
    call<string>('regenerate_recovery', { masterPassword, criticalPassword }),
  argon2Info: () => call<KdfParams>('argon2_info'),
  retuneArgon2: (masterPassword: string, criticalPassword: string) =>
    call<KdfParams>('retune_argon2', { masterPassword, criticalPassword }),
  exportBackup: (path: string) => call<void>('export_backup', { path }),
  importBackup: (path: string) => call<void>('import_backup', { path }),
  deleteVault: (masterPassword: string, criticalPassword: string) =>
    call<void>('delete_vault', { masterPassword, criticalPassword }),
  saveRecoveryKey: (path: string, key: string) => call<void>('save_recovery_key', { path, key }),
  copyRecoveryKey: (key: string) => call<CopyResponse>('copy_recovery_key', { key }),
  openVaultLocation: () => call<void>('open_vault_location'),
};

export async function onLocked(callback: () => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen('keyfold:locked', () => callback());
}

export async function onCriticalLocked(callback: () => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen('keyfold:critical-locked', () => callback());
}

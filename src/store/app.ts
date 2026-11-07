import { create } from 'zustand';

import { errorMessage } from '@/lib/errors';
import { api } from '@/lib/ipc';
import type {
  AppInfo,
  CreateVaultResponse,
  FolderDraft,
  FolderPatch,
  KdfParams,
  KeyDraft,
  KeyPatch,
  SessionStatus,
  Settings,
  Tier,
  VaultStats,
  ViewMode,
  WorkspaceView,
} from '@/lib/types';

export type Route = 'onboarding' | 'locked' | 'workspace';
export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const EMPTY_SESSION: SessionStatus = {
  standardUnlocked: false,
  criticalUnlocked: false,
  standardLockInSeconds: null,
  criticalLockInSeconds: null,
};

let toastId = 0;

function applyPreferences(settings: Settings): void {
  document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion);
  document.documentElement.classList.toggle('compact', settings.compactMode);
}

function storedViewMode(): ViewMode {
  return localStorage.getItem('keyfold.viewMode') === 'cards' ? 'cards' : 'list';
}

interface AppStore {
  booted: boolean;
  bootError: string | null;
  route: Route;
  workspace: WorkspaceView | null;
  settings: Settings | null;
  session: SessionStatus;
  info: AppInfo | null;
  kdf: KdfParams | null;
  vaultStats: VaultStats | null;
  selectedTier: Tier;
  selectedFolderId: string | null;
  viewMode: ViewMode;
  searchOpen: boolean;
  plusOpen: boolean;
  settingsOpen: boolean;
  sidebarCollapsed: boolean;
  toasts: Toast[];
  busy: boolean;
  /** Bumped whenever revealed secrets must be wiped from the UI. */
  secretsEpoch: number;

  init: () => Promise<void>;
  createVault: (master: string, critical: string) => Promise<CreateVaultResponse>;
  finishOnboarding: () => void;
  unlock: (password: string) => Promise<void>;
  unlockCritical: (password: string) => Promise<void>;
  unlockRecovery: (key: string) => Promise<void>;
  lock: () => Promise<void>;
  lockCritical: () => Promise<void>;
  refreshSession: () => Promise<void>;
  refresh: () => Promise<void>;
  selectTier: (tier: Tier) => void;
  selectFolder: (folderId: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setSearchOpen: (open: boolean) => void;
  setPlusOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  createFolder: (input: FolderDraft) => Promise<void>;
  updateFolder: (input: FolderPatch) => Promise<void>;
  deleteFolder: (id: string, confirmName: string) => Promise<void>;
  createKey: (input: KeyDraft) => Promise<void>;
  updateKey: (input: KeyPatch) => Promise<void>;
  moveKey: (id: string, tier: Tier, folderId: string | null) => Promise<void>;
  deleteKey: (id: string) => Promise<void>;
  reorderFolders: (tier: Tier, ids: string[]) => Promise<void>;
  copySecret: (id: string) => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  changeMaster: (current: string, next: string) => Promise<void>;
  changeCritical: (current: string, next: string) => Promise<void>;
  fetchStats: () => Promise<void>;
  regenerateRecovery: (master: string, critical: string) => Promise<string>;
  retune: (master: string, critical: string) => Promise<KdfParams>;
  importBackup: (path: string) => Promise<void>;
  deleteVault: (master: string, critical: string) => Promise<void>;
  resetVault: () => Promise<void>;
  toast: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: number) => void;
  setBusy: (busy: boolean) => void;
  hideSecrets: () => void;
}

export const useApp = create<AppStore>((set, get) => ({
  booted: false,
  bootError: null,
  route: 'locked',
  workspace: null,
  settings: null,
  session: EMPTY_SESSION,
  info: null,
  kdf: null,
  vaultStats: null,
  selectedTier: 'standard',
  selectedFolderId: null,
  viewMode: storedViewMode(),
  searchOpen: false,
  plusOpen: false,
  settingsOpen: false,
  sidebarCollapsed: restoreSidebar(),
  toasts: [],
  busy: false,
  secretsEpoch: 0,

  init: async () => {
    try {
      const info = await api.appInfo();
      const exists = await api.vaultExists();
      let kdf: KdfParams | null = null;
      if (exists) {
        kdf = await api.argon2Info().catch(() => null);
        try {
          const workspace = await api.workspace();
          applyPreferences(workspace.settings);
          const stats = await api.vaultStats().catch(() => null);
          set({
            booted: true,
            info,
            kdf,
            route: 'workspace',
            workspace,
            settings: workspace.settings,
            session: await api.sessionStatus(),
            vaultStats: stats,
          });
          return;
        } catch {
          // Locked, which is the normal cold-start state.
        }
      }
      set({ booted: true, info, kdf, route: exists ? 'locked' : 'onboarding' });
    } catch (error) {
      set({ booted: true, bootError: errorMessage(error), route: 'onboarding' });
    }
  },

  createVault: async (master, critical) => {
    const response = await api.createVault(master, critical);
    applyPreferences(response.workspace.settings);
    // The route stays on onboarding until the recovery key has been shown and
    // confirmed; the vault itself is already created and unlocked.
    set({
      workspace: response.workspace,
      settings: response.workspace.settings,
      session: await api.sessionStatus(),
    });
    return response;
  },

  finishOnboarding: () => set({ route: 'workspace' }),

  unlock: async (password) => {
    const workspace = await api.unlock(password);
    applyPreferences(workspace.settings);
    const stats = await api.vaultStats().catch(() => null);
    set({
      route: 'workspace',
      workspace,
      settings: workspace.settings,
      session: await api.sessionStatus(),
      vaultStats: stats,
    });
  },

  unlockCritical: async (password) => {
    const workspace = await api.unlockCritical(password);
    const stats = await api.vaultStats().catch(() => null);
    set({
      workspace,
      session: await api.sessionStatus(),
      selectedTier: 'critical',
      selectedFolderId: null,
      vaultStats: stats,
    });
  },

  unlockRecovery: async (key) => {
    const workspace = await api.unlockRecovery(key);
    applyPreferences(workspace.settings);
    const stats = await api.vaultStats().catch(() => null);
    set({
      route: 'workspace',
      workspace,
      settings: workspace.settings,
      session: await api.sessionStatus(),
      vaultStats: stats,
    });
  },

  lock: async () => {
    await api.lock();
    get().hideSecrets();
    set({
      route: 'locked',
      workspace: null,
      session: EMPTY_SESSION,
      selectedFolderId: null,
      searchOpen: false,
      plusOpen: false,
      settingsOpen: false,
    });
  },

  lockCritical: async () => {
    await api.lockCritical();
    get().hideSecrets();
    const workspace = await api.workspace();
    set({
      workspace,
      session: await api.sessionStatus(),
      selectedTier: 'standard',
      selectedFolderId: null,
    });
    get().toast('Critical tier locked.', 'info');
  },

  refreshSession: async () => {
    const status = await api.sessionStatus();
    const current = get();
    if (current.route !== 'workspace') {
      set({ session: status });
      return;
    }
    if (!status.standardUnlocked) {
      get().hideSecrets();
      set({
        session: status,
        route: 'locked',
        workspace: null,
        selectedFolderId: null,
        searchOpen: false,
        plusOpen: false,
        settingsOpen: false,
      });
      return;
    }
    if (current.workspace?.criticalUnlocked && !status.criticalUnlocked) {
      get().hideSecrets();
      set({ session: status });
      await get().refresh();
      return;
    }
    set({ session: status });
  },

  refresh: async () => {
    const workspace = await api.workspace();
    set({ workspace, settings: workspace.settings, session: await api.sessionStatus() });
    applyPreferences(workspace.settings);
  },

  selectTier: (tier) => set({ selectedTier: tier, selectedFolderId: null }),
  selectFolder: (folderId) => set({ selectedFolderId: folderId }),
  setViewMode: (mode) => {
    localStorage.setItem('keyfold.viewMode', mode);
    set({ viewMode: mode });
  },
  setSearchOpen: (open) => set({ searchOpen: open }),
  setPlusOpen: (open) => set({ plusOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  toggleSidebar: () =>
    set((state) => {
      const collapsed = !state.sidebarCollapsed;
      localStorage.setItem('keyfold.sidebar', collapsed ? 'collapsed' : 'expanded');
      return { sidebarCollapsed: collapsed };
    }),

  createFolder: async (input) => {
    await api.createFolder(input);
    await get().refresh();
    get().toast(`Folder "${input.name.trim()}" created.`);
  },

  updateFolder: async (input) => {
    await api.updateFolder(input);
    await get().refresh();
    get().toast('Folder updated.');
  },

  deleteFolder: async (id, confirmName) => {
    await api.deleteFolder(id, confirmName);
    set({ selectedFolderId: null });
    await get().refresh();
    get().toast('Folder deleted.', 'info');
  },

  createKey: async (input) => {
    await api.createKey(input);
    await get().refresh();
    get().toast(`Key "${input.label.trim()}" saved.`);
  },

  updateKey: async (input) => {
    await api.updateKey(input);
    await get().refresh();
    get().toast('Key updated.');
  },

  moveKey: async (id, tier, folderId) => {
    const workspace = await api.moveKey({ id, targetTier: tier, targetFolderId: folderId });
    set({ workspace, session: await api.sessionStatus() });
    get().toast(`Key moved to ${tier === 'critical' ? 'Critical' : 'Standard'}.`);
  },

  deleteKey: async (id) => {
    const workspace = await api.deleteKey(id);
    set({ workspace, session: await api.sessionStatus() });
    get().toast('Key deleted.', 'info');
  },

  reorderFolders: async (tier, ids) => {
    await api.reorderFolders(tier, ids);
    await get().refresh();
  },

  copySecret: async (id) => {
    const response = await api.copySecret(id);
    get().toast(`Copied. Clipboard clears in ${response.clearsInSeconds}s.`);
    await get().refresh();
  },

  saveSettings: async (settings) => {
    const saved = await api.setSettings(settings);
    applyPreferences(saved);
    set((state) => ({
      settings: saved,
      workspace: state.workspace ? { ...state.workspace, settings: saved } : null,
    }));
  },

  changeMaster: async (current, next) => {
    await api.changeMaster(current, next);
    get().toast('Standard password changed.');
  },

  changeCritical: async (current, next) => {
    await api.changeCritical(current, next);
    await get().refresh();
    get().toast('Critical password changed.');
  },

  fetchStats: async () => {
    const stats = await api.vaultStats().catch(() => null);
    set({ vaultStats: stats });
  },

  regenerateRecovery: async (master, critical) => {
    const key = await api.regenerateRecovery(master, critical);
    get().toast('New recovery key generated.');
    return key;
  },

  retune: async (master, critical) => {
    const params = await api.retuneArgon2(master, critical);
    set({ kdf: params });
    get().toast('Argon2id cost re-tuned for this machine.');
    return params;
  },

  importBackup: async (path) => {
    await api.importBackup(path);
    get().hideSecrets();
    set({
      route: 'locked',
      workspace: null,
      session: EMPTY_SESSION,
      kdf: null,
      settingsOpen: false,
    });
    get().toast('Backup imported. Unlock it with that vault’s passwords.', 'info');
  },

  deleteVault: async (master, critical) => {
    await api.deleteVault(master, critical);
    get().hideSecrets();
    set({
      route: 'onboarding',
      workspace: null,
      session: EMPTY_SESSION,
      kdf: null,
      selectedFolderId: null,
    });
    get().toast('Vault deleted. A new one can be created now.', 'info');
  },

  resetVault: async () => {
    await api.resetVault();
    get().hideSecrets();
    set({
      route: 'onboarding',
      workspace: null,
      session: EMPTY_SESSION,
      kdf: null,
      selectedFolderId: null,
    });
    get().toast('Vault reset. A new one can be created now.', 'info');
  },

  toast: (message, tone = 'success') => {
    const id = ++toastId;
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    window.setTimeout(() => get().dismissToast(id), 4200);
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  setBusy: (busy) => set({ busy }),

  hideSecrets: () => set((state) => ({ secretsEpoch: state.secretsEpoch + 1 })),
}));

export function restoreSidebar(): boolean {
  return localStorage.getItem('keyfold.sidebar') === 'collapsed';
}

if (import.meta.env.DEV) {
  (window as Window & { __keyfold?: typeof useApp }).__keyfold = useApp;
}

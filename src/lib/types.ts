export type Tier = 'standard' | 'critical';
export type ViewMode = 'list' | 'cards';

export interface SessionStatus {
  standardUnlocked: boolean;
  criticalUnlocked: boolean;
  standardLockInSeconds: number | null;
  criticalLockInSeconds: number | null;
}

export interface Settings {
  autoLockMinutes: number;
  criticalAutoLockSeconds: number;
  clipboardClearSeconds: number;
  lockOnMinimize: boolean;
  reduceMotion: boolean;
  compactMode: boolean;
  screenCaptureProtected: boolean;
}

export interface KeyView {
  id: string;
  label: string;
  hint: string;
  provider: string | null;
  tags: string[];
  note: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastCopiedAt: string | null;
  folderId: string | null;
}

export interface FolderView {
  id: string;
  name: string;
  icon: string;
  color: string;
  note: string | null;
  keyCount: number;
  createdAt: string;
  updatedAt: string;
  keys: KeyView[];
}

export interface TierView {
  folders: FolderView[];
  keys: KeyView[];
  keyCount: number;
}

export interface WorkspaceView {
  vaultId: string;
  createdAt: string;
  settings: Settings;
  standard: TierView;
  critical: TierView | null;
  criticalUnlocked: boolean;
}

export interface SearchHit {
  id: string;
  tier: Tier;
  label: string;
  provider: string | null;
  folderId: string | null;
  folderName: string | null;
}

export interface AppInfo {
  version: string;
  formatVersion: number;
  vaultPath: string;
}

export interface TagStat {
  name: string;
  count: number;
}

export interface VaultStats {
  standardKeys: number;
  standardFolders: number;
  criticalKeys: number;
  criticalFolders: number;
  tags: TagStat[];
}

export interface KdfParams {
  memoryKib: number;
  iterations: number;
  parallelism: number;
}

export interface CreateVaultResponse {
  recoveryKey: string;
  workspace: WorkspaceView;
}

export interface CopyResponse {
  clearsInSeconds: number;
}

export interface FolderDraft {
  tier: Tier;
  name: string;
  icon: string;
  color: string;
  note: string | null;
}

export interface FolderPatch {
  id: string;
  name: string;
  icon: string;
  color: string;
  note: string | null;
}

export interface KeyDraft {
  tier: Tier;
  folderId: string | null;
  label: string;
  value: string;
  note: string | null;
  provider: string | null;
  tags: string[];
  expiresAt: string | null;
}

export interface KeyPatch {
  id: string;
  label: string;
  value: string | null;
  note: string | null;
  provider: string | null;
  tags: string[];
  expiresAt: string | null;
}

export interface MoveKeyInput {
  id: string;
  targetTier: Tier;
  targetFolderId: string | null;
}

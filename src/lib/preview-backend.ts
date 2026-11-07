/**
 * DEV-ONLY UI PREVIEW HARNESS.
 *
 * It exists so the interface can be reviewed in a browser with `npm run dev`.
 * It performs no cryptography, writes nothing to disk, and keeps every value
 * in memory only. A production build never includes this file: `ipc.ts` only
 * reaches it behind `import.meta.env.DEV`, so Vite removes it from releases.
 */
import type {
  CopyResponse,
  FolderView,
  KdfParams,
  KeyView,
  SearchHit,
  SessionStatus,
  Settings,
  Tier,
  TierView,
  WorkspaceView,
} from './types';

interface PreviewKey {
  id: string;
  label: string;
  value: string;
  hint: string;
  provider: string | null;
  tags: string[];
  note: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastCopiedAt: string | null;
}

interface PreviewFolder {
  id: string;
  name: string;
  icon: string;
  color: string;
  note: string | null;
  keys: PreviewKey[];
  createdAt: string;
  updatedAt: string;
}

interface PreviewTier {
  folders: PreviewFolder[];
  keys: PreviewKey[];
}

interface PreviewVault {
  master: string;
  critical: string;
  recoveryKey: string;
  createdAt: string;
  settings: Settings;
  standard: PreviewTier;
  criticalTier: PreviewTier;
}

const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 5,
  criticalAutoLockSeconds: 60,
  clipboardClearSeconds: 20,
  lockOnMinimize: true,
  reduceMotion: false,
  compactMode: false,
  screenCaptureProtected: true,
};

let vault: PreviewVault | null = null;
let unlocked = false;
let criticalUnlocked = false;
let recoveryMode = false;
let lastActivity = Date.now();
let criticalActivity = Date.now();
let failures = 0;
let blockedUntil = 0;
let seeded = false;

const now = (): string => new Date().toISOString();
const id = (): string => crypto.randomUUID();

function maskHint(value: string): string {
  if (value.length < 12) return '••••••••••••';
  return `${value.slice(0, 3)}••••••••${value.slice(-4)}`;
}

/** Dev-only sample data so the workspace can be reviewed without onboarding. */
function seedIfRequested(): void {
  if (seeded) return;
  seeded = true;
  if (!new URLSearchParams(window.location.search).has('seed')) return;
  const stamp = now();
  const key = (
    label: string,
    value: string,
    provider: string,
    extra: Partial<PreviewKey> = {},
  ): PreviewKey => ({
    id: id(),
    label,
    value,
    hint: maskHint(value),
    provider,
    tags: [],
    note: null,
    expiresAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    lastCopiedAt: null,
    ...extra,
  });
  vault = {
    master: 'preview-master-pass',
    critical: 'preview-critical-pass',
    recoveryKey: makeRecoveryKey(),
    createdAt: stamp,
    settings: { ...DEFAULT_SETTINGS, criticalAutoLockSeconds: 300 },
    standard: {
      folders: [
        {
          id: id(),
          name: 'Stripe',
          icon: 'code',
          color: 'indigo',
          note: 'Billing and checkout keys for the main app.',
          keys: [
            key('Live secret key', 'sk_live_51Nz8kL2eZvKYlo2C9fJ2mQ3x', 'Stripe', {
              tags: ['production', 'billing'],
            }),
            key('Test secret key', 'sk_test_51Nz8kL2eZvKYlo2C4hK9pR7w', 'Stripe'),
          ],
          createdAt: stamp,
          updatedAt: stamp,
        },
      ],
      keys: [
        key('GitHub personal token', 'ghp_9dK2mQ7xR4vN8pL1cT6bY3wZ5sA0eF2gH', 'GitHub', {
          note: 'Read-only token used by the release workflow.',
        }),
      ],
    },
    criticalTier: {
      folders: [
        {
          id: id(),
          name: 'OpenAI',
          icon: 'sparkles',
          color: 'emerald',
          note: 'Production model access.',
          keys: [
            key('Production — main app', 'sk-proj-8f2c9d7a1b6e4f3c2d1e0a9b8c7d6e5f3f9a', 'OpenAI', {
              tags: ['production'],
              expiresAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
            }),
            key('Staging — evals', 'sk-proj-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f', 'OpenAI'),
          ],
          createdAt: stamp,
          updatedAt: stamp,
        },
      ],
      keys: [
        key('Anthropic production', 'sk-ant-api03-Q7mK2pR9vN4xL8cT1bY6wZ3sA0eF5gH2', 'Anthropic', {
          tags: ['production', 'critical'],
        }),
      ],
    },
  };
  unlocked = true;
  criticalUnlocked = false;
  recoveryMode = false;
  lastActivity = Date.now();
  criticalActivity = Date.now();
}

function makeRecoveryKey(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bits = 0;
  let buffer = 0;
  let out = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31];
  return (out.match(/.{1,4}/g) ?? []).join('-');
}

function expire(): void {
  if (!vault || !unlocked) return;
  const standardWindow = vault.settings.autoLockMinutes * 60_000;
  if (standardWindow > 0 && Date.now() - lastActivity > standardWindow) {
    unlocked = false;
    criticalUnlocked = false;
    return;
  }
  if (
    criticalUnlocked &&
    Date.now() - criticalActivity > vault.settings.criticalAutoLockSeconds * 1000
  ) {
    criticalUnlocked = false;
  }
}

function requireUnlocked(): PreviewVault {
  expire();
  if (!unlocked || !vault) throw new Error('The vault is locked.');
  return vault;
}

function requireCritical(): PreviewTier {
  const data = requireUnlocked();
  if (!criticalUnlocked) throw new Error('The Critical tier is locked.');
  return data.criticalTier;
}

function tierOf(tier: Tier): PreviewTier {
  if (tier === 'standard') return requireUnlocked().standard;
  return requireCritical();
}

function keyView(key: PreviewKey, folderId: string | null): KeyView {
  return { ...key, folderId };
}

function folderView(folder: PreviewFolder): FolderView {
  return {
    id: folder.id,
    name: folder.name,
    icon: folder.icon,
    color: folder.color,
    note: folder.note,
    keyCount: folder.keys.length,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    keys: folder.keys.map((key) => keyView(key, folder.id)),
  };
}

function tierView(tier: PreviewTier): TierView {
  return {
    folders: tier.folders.map(folderView),
    keys: tier.keys.map((key) => keyView(key, null)),
    keyCount: tier.keys.length + tier.folders.reduce((sum, folder) => sum + folder.keys.length, 0),
  };
}

function workspace(): WorkspaceView {
  const data = requireUnlocked();
  return {
    vaultId: 'preview',
    createdAt: data.createdAt,
    settings: data.settings,
    standard: tierView(data.standard),
    critical: criticalUnlocked ? tierView(data.criticalTier) : null,
    criticalUnlocked,
  };
}

function locate(keyId: string): {
  tier: Tier;
  key: PreviewKey;
  folder: PreviewFolder | null;
  list: PreviewKey[];
} {
  const data = requireUnlocked();
  const tiers: { tier: Tier; data: PreviewTier }[] = [
    { tier: 'standard', data: data.standard },
    ...(criticalUnlocked ? [{ tier: 'critical' as Tier, data: data.criticalTier }] : []),
  ];
  for (const entry of tiers) {
    const idx = entry.data.keys.findIndex((key) => key.id === keyId);
    const rootKey = entry.data.keys[idx];
    if (rootKey) {
      return { tier: entry.tier, key: rootKey, folder: null, list: entry.data.keys };
    }
    for (const folder of entry.data.folders) {
      const key = folder.keys.find((candidate) => candidate.id === keyId);
      if (key) {
        return { tier: entry.tier, key, folder, list: folder.keys };
      }
    }
  }
  throw new Error('That key no longer exists.');
}

function status(): SessionStatus {
  expire();
  if (!vault || !unlocked) {
    return {
      standardUnlocked: false,
      criticalUnlocked: false,
      standardLockInSeconds: null,
      criticalLockInSeconds: null,
    };
  }
  const standardLockInSeconds =
    vault.settings.autoLockMinutes === 0
      ? null
      : Math.max(
          0,
          vault.settings.autoLockMinutes * 60 - Math.floor((Date.now() - lastActivity) / 1000),
        );
  const criticalLockInSeconds = criticalUnlocked
    ? Math.max(
        0,
        vault.settings.criticalAutoLockSeconds - Math.floor((Date.now() - criticalActivity) / 1000),
      )
    : null;
  return {
    standardUnlocked: true,
    criticalUnlocked,
    standardLockInSeconds,
    criticalLockInSeconds,
  };
}

const kdf: KdfParams = { memoryKib: 262144, iterations: 3, parallelism: 4 };

type Args = Record<string, unknown>;

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : '';
}

export async function previewInvoke(command: string, rawArgs?: Args): Promise<unknown> {
  seedIfRequested();
  const args: Args = rawArgs ?? {};
  switch (command) {
    case 'vault_exists':
      return vault !== null;
    case 'app_info':
      return {
        version: '0.1.0',
        formatVersion: 1,
        vaultPath: 'Browser preview (memory only)',
      };
    case 'create_vault': {
      const master = text(args, 'masterPassword');
      const critical = text(args, 'criticalPassword');
      if (master.length < 12)
        throw new Error('The Standard password must be at least 12 characters.');
      if (critical.length < 12)
        throw new Error('The Critical password must be at least 12 characters.');
      if (master === critical)
        throw new Error('The Standard and Critical passwords must be different.');
      const recoveryKey = makeRecoveryKey();
      vault = {
        master,
        critical,
        recoveryKey,
        createdAt: now(),
        settings: { ...DEFAULT_SETTINGS },
        standard: { folders: [], keys: [] },
        criticalTier: { folders: [], keys: [] },
      };
      unlocked = true;
      criticalUnlocked = true;
      recoveryMode = false;
      lastActivity = Date.now();
      criticalActivity = Date.now();
      return { recoveryKey, workspace: workspace() };
    }
    case 'unlock': {
      expire();
      if (blockedUntil > Date.now()) {
        throw new Error(
          `Too many failed attempts. Try again in ${Math.ceil((blockedUntil - Date.now()) / 1000)} seconds.`,
        );
      }
      if (!vault) throw new Error('The vault could not be found.');
      const password = text(args, 'password');
      if (password !== vault.master) {
        failures += 1;
        if (failures >= 5) {
          blockedUntil = Date.now() + Math.min(2 ** (failures - 5) * 2000, 60_000);
        }
        throw new Error('That password is incorrect.');
      }
      failures = 0;
      unlocked = true;
      criticalUnlocked = false;
      lastActivity = Date.now();
      return workspace();
    }
    case 'unlock_critical': {
      const data = requireUnlocked();
      const password = text(args, 'password');
      if (password !== data.critical) throw new Error('The Critical password is incorrect.');
      criticalUnlocked = true;
      criticalActivity = Date.now();
      return workspace();
    }
    case 'unlock_recovery': {
      if (!vault) throw new Error('The vault could not be found.');
      const normalized = text(args, 'recoveryKey')
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '');
      if (normalized !== vault.recoveryKey.replace(/-/g, '')) {
        throw new Error('That recovery key is not valid.');
      }
      unlocked = true;
      criticalUnlocked = true;
      recoveryMode = true;
      lastActivity = Date.now();
      criticalActivity = Date.now();
      return workspace();
    }
    case 'lock':
      unlocked = false;
      criticalUnlocked = false;
      return null;
    case 'lock_critical':
      if (!unlocked) throw new Error('The vault is locked.');
      criticalUnlocked = false;
      return null;
    case 'session_status':
      return status();
    case 'touch':
      if (unlocked) lastActivity = Date.now();
      return null;
    case 'touch_critical':
      if (criticalUnlocked) {
        criticalActivity = Date.now();
        lastActivity = Date.now();
      }
      return null;
    case 'get_workspace':
      return workspace();
    case 'list_tree':
      return tierView(tierOf(String(args.tier) as Tier));
    case 'get_secret': {
      const found = locate(text(args, 'entryId'));
      if (found.tier === 'critical') criticalActivity = Date.now();
      return found.key.value;
    }
    case 'copy_secret': {
      const found = locate(text(args, 'entryId'));
      const data = requireUnlocked();
      await navigator.clipboard.writeText(found.key.value).catch(() => undefined);
      found.key.lastCopiedAt = now();
      if (found.tier === 'critical') criticalActivity = Date.now();
      setTimeout(() => {
        void navigator.clipboard.writeText('').catch(() => undefined);
      }, data.settings.clipboardClearSeconds * 1000);
      return { clearsInSeconds: data.settings.clipboardClearSeconds } satisfies CopyResponse;
    }
    case 'create_folder': {
      const input = args.input as {
        tier: Tier;
        name: string;
        icon: string;
        color: string;
        note: string | null;
      };
      const tier = tierOf(input.tier);
      const name = input.name.trim();
      if (!name) throw new Error('Folder name cannot be empty.');
      tier.folders.push({
        id: id(),
        name,
        icon: input.icon,
        color: input.color,
        note: input.note,
        keys: [],
        createdAt: now(),
        updatedAt: now(),
      });
      return tierView(tier);
    }
    case 'update_folder': {
      const input = args.input as {
        id: string;
        name: string;
        icon: string;
        color: string;
        note: string | null;
      };
      const data = requireUnlocked();
      const tiers: { tier: Tier; data: PreviewTier }[] = [
        { tier: 'standard', data: data.standard },
        ...(criticalUnlocked ? [{ tier: 'critical' as Tier, data: data.criticalTier }] : []),
      ];
      for (const entry of tiers) {
        const folder = entry.data.folders.find((candidate) => candidate.id === input.id);
        if (!folder) continue;
        folder.name = input.name.trim() || folder.name;
        folder.icon = input.icon;
        folder.color = input.color;
        folder.note = input.note;
        folder.updatedAt = now();
        return tierView(entry.data);
      }
      throw new Error('That folder no longer exists.');
    }
    case 'delete_folder': {
      const input = args.input as { id: string; confirmName: string };
      const data = requireUnlocked();
      const tiers: PreviewTier[] = [
        data.standard,
        ...(criticalUnlocked ? [data.criticalTier] : []),
      ];
      for (const tier of tiers) {
        const folder = tier.folders.find((candidate) => candidate.id === input.id);
        if (folder) {
          if (folder.keys.length > 0 && input.confirmName.trim() !== folder.name) {
            throw new Error('Type the folder name exactly to delete a folder that contains keys.');
          }
          tier.folders = tier.folders.filter((candidate) => candidate.id !== input.id);
          return tierView(tier);
        }
      }
      throw new Error('That folder no longer exists.');
    }
    case 'create_key': {
      const input = args.input as {
        tier: Tier;
        folderId: string | null;
        label: string;
        value: string;
        note: string | null;
        provider: string | null;
        tags: string[];
        expiresAt: string | null;
      };
      const tier = tierOf(input.tier);
      if (!input.label.trim()) throw new Error('Label cannot be empty.');
      if (!input.value) throw new Error('The key value cannot be empty.');
      const key: PreviewKey = {
        id: id(),
        label: input.label.trim(),
        value: input.value,
        hint: maskHint(input.value),
        provider: input.provider,
        tags: input.tags,
        note: input.note,
        expiresAt: input.expiresAt,
        createdAt: now(),
        updatedAt: now(),
        lastCopiedAt: null,
      };
      if (input.folderId) {
        const folder = tier.folders.find((candidate) => candidate.id === input.folderId);
        if (!folder) throw new Error('That folder no longer exists.');
        folder.keys.push(key);
        folder.updatedAt = now();
      } else {
        tier.keys.push(key);
      }
      return keyView(key, input.folderId);
    }
    case 'update_key': {
      const input = args.input as {
        id: string;
        label: string;
        value: string | null;
        note: string | null;
        provider: string | null;
        tags: string[];
        expiresAt: string | null;
      };
      const found = locate(input.id);
      found.key.label = input.label.trim() || found.key.label;
      if (input.value) {
        found.key.value = input.value;
        found.key.hint = maskHint(input.value);
      }
      found.key.note = input.note;
      found.key.provider = input.provider;
      found.key.tags = input.tags;
      found.key.expiresAt = input.expiresAt;
      found.key.updatedAt = now();
      return keyView(found.key, found.folder?.id ?? null);
    }
    case 'move_key': {
      const input = args.input as {
        id: string;
        targetTier: Tier;
        targetFolderId: string | null;
      };
      const found = locate(input.id);
      const target = tierOf(input.targetTier);
      if (
        input.targetFolderId &&
        !target.folders.some((folder) => folder.id === input.targetFolderId)
      ) {
        throw new Error('That folder no longer exists.');
      }
      found.list.splice(found.list.indexOf(found.key), 1);
      if (input.targetFolderId) {
        const folder = target.folders.find((candidate) => candidate.id === input.targetFolderId);
        folder?.keys.push(found.key);
      } else {
        target.keys.push(found.key);
      }
      if (input.targetTier === 'critical') criticalActivity = Date.now();
      return workspace();
    }
    case 'delete_key': {
      const found = locate(text(args, 'entryId'));
      found.list.splice(found.list.indexOf(found.key), 1);
      return workspace();
    }
    case 'reorder_folders': {
      const tier = tierOf(String(args.tier) as Tier);
      const order = args.folderIds as string[];
      const next = order
        .map((folderId) => tier.folders.find((folder) => folder.id === folderId))
        .filter((folder): folder is PreviewFolder => Boolean(folder));
      if (next.length !== tier.folders.length) throw new Error('Folder order is incomplete.');
      tier.folders = next;
      return tierView(tier);
    }
    case 'search': {
      const query = text(args, 'query').trim().toLowerCase();
      if (!query) return [];
      const data = requireUnlocked();
      const hits: SearchHit[] = [];
      const scan = (tier: Tier, list: PreviewTier): void => {
        const add = (key: PreviewKey, folder: PreviewFolder | null): void => {
          const haystack = [key.label, key.provider ?? '', key.tags.join(' '), folder?.name ?? '']
            .join(' ')
            .toLowerCase();
          if (haystack.includes(query)) {
            hits.push({
              id: key.id,
              tier,
              label: key.label,
              provider: key.provider,
              folderId: folder?.id ?? null,
              folderName: folder?.name ?? null,
            });
          }
        };
        list.keys.forEach((key) => add(key, null));
        list.folders.forEach((folder) => folder.keys.forEach((key) => add(key, folder)));
      };
      scan('standard', data.standard);
      if (criticalUnlocked) scan('critical', data.criticalTier);
      return hits.slice(0, 50);
    }
    case 'get_settings':
      return requireUnlocked().settings;
    case 'set_settings': {
      const data = requireUnlocked();
      data.settings = args.settings as Settings;
      return data.settings;
    }
    case 'change_master': {
      const data = requireUnlocked();
      if (recoveryMode) throw new Error('Unlock with your passwords before changing them.');
      if (String(args.currentPassword) !== data.master)
        throw new Error('That password is incorrect.');
      const next = String(args.newPassword);
      if (next.length < 12)
        throw new Error('The new Standard password must be at least 12 characters.');
      if (next === data.critical)
        throw new Error('The Standard and Critical passwords must be different.');
      data.master = next;
      return null;
    }
    case 'change_critical': {
      const data = requireUnlocked();
      if (recoveryMode) throw new Error('Unlock with your passwords before changing them.');
      if (!criticalUnlocked) throw new Error('The Critical tier is locked.');
      if (String(args.currentPassword) !== data.critical) {
        throw new Error('The Critical password is incorrect.');
      }
      const next = String(args.newPassword);
      if (next.length < 12)
        throw new Error('The new Critical password must be at least 12 characters.');
      if (next === data.master)
        throw new Error('The Standard and Critical passwords must be different.');
      data.critical = next;
      return null;
    }
    case 'regenerate_recovery': {
      const data = requireUnlocked();
      if (String(args.masterPassword) !== data.master)
        throw new Error('That password is incorrect.');
      if (!criticalUnlocked || String(args.criticalPassword) !== data.critical) {
        throw new Error('The Critical password is incorrect.');
      }
      data.recoveryKey = makeRecoveryKey();
      return data.recoveryKey;
    }
    case 'argon2_info':
      return kdf;
    case 'retune_argon2':
      return kdf;
    case 'vault_stats': {
      const data = requireUnlocked();
      const tagCounts = new Map<string, number>();
      const scan = (tier: PreviewTier): void => {
        tier.keys.forEach((key) => {
          for (const tag of key.tags) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
          }
        });
        tier.folders.forEach((folder) => {
          folder.keys.forEach((key) => {
            for (const tag of key.tags) {
              tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
            }
          });
        });
      };
      scan(data.standard);
      if (data.criticalTier) scan(data.criticalTier);
      const tags = Array.from(tagCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return {
        standardKeys: data.standard.keys.length + data.standard.folders.reduce((sum, f) => sum + f.keys.length, 0),
        standardFolders: data.standard.folders.length,
        criticalKeys: data.criticalTier
          ? data.criticalTier.keys.length + data.criticalTier.folders.reduce((sum, f) => sum + f.keys.length, 0)
          : 0,
        criticalFolders: data.criticalTier ? data.criticalTier.folders.length : 0,
        tags,
      };
    }
    case 'export_backup':
    case 'import_backup':
      throw new Error('Encrypted backups are available in the desktop app. This is a UI preview.');
    case 'delete_vault':
      vault = null;
      unlocked = false;
      criticalUnlocked = false;
      return null;
    case 'reset_vault':
      vault = null;
      unlocked = false;
      criticalUnlocked = false;
      return null;
    case 'open_vault_location':
      return null;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

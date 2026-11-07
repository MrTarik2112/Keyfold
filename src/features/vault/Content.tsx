import {
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  FolderPlus,
  KeyRound,
  LayoutGrid,
  List,
  Lock,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';

import { Button, EmptyState, IconButton, Kbd, Select } from '@/components/ui';
import { CriticalGate } from '@/features/critical-gate/CriticalGate';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { expiryState, formatCountdown } from '@/lib/format';
import { api } from '@/lib/ipc';
import type { FolderView, KeyView, Tier } from '@/lib/types';
import { useApp } from '@/store/app';
import { ConfirmDialog, FolderDialog, KeyDialog, MoveDialog } from './dialogs';
import { folderHex } from './folder-icons';
import { FolderGlyph } from './glyphs';
import { KeyItem } from './KeyItem';
import { PlusMenu } from './PlusMenu';

type SortMode = 'updated' | 'name' | 'expiry';

interface DeleteTarget {
  kind: 'key' | 'folder';
  id: string;
  name: string;
  keyCount: number;
}

export function Content() {
  const workspace = useApp((state) => state.workspace);
  const tier = useApp((state) => state.selectedTier);
  const selectedFolderId = useApp((state) => state.selectedFolderId);
  const selectFolder = useApp((state) => state.selectFolder);
  const viewMode = useApp((state) => state.viewMode);
  const setViewMode = useApp((state) => state.setViewMode);
  const setSearchOpen = useApp((state) => state.setSearchOpen);
  const setPlusOpen = useApp((state) => state.setPlusOpen);
  const session = useApp((state) => state.session);
  const deleteKey = useApp((state) => state.deleteKey);
  const deleteFolder = useApp((state) => state.deleteFolder);
  const reorderFolders = useApp((state) => state.reorderFolders);
  const moveKey = useApp((state) => state.moveKey);
  const toast = useApp((state) => state.toast);

  const [folderDialog, setFolderDialog] = useState<{ open: boolean; folder: FolderView | null }>({
    open: false,
    folder: null,
  });
  const [keyDialog, setKeyDialog] = useState<{ open: boolean; entry: KeyView | null }>({
    open: false,
    entry: null,
  });
  const [moveEntry, setMoveEntry] = useState<KeyView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [sort, setSort] = useState<SortMode>('updated');
  const [onlyExpiring, setOnlyExpiring] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [dragFolder, setDragFolder] = useState<string | null>(null);

  const locked = tier === 'critical' && !workspace?.criticalUnlocked;
  const data = (tier === 'critical' ? workspace?.critical : workspace?.standard) ?? {
    folders: [],
    keys: [],
    keyCount: 0,
  };
  const folder = data.folders.find((candidate) => candidate.id === selectedFolderId) ?? null;

  const sortKeys = useMemo(
    () =>
      (keys: KeyView[]): KeyView[] => {
        const filtered = keys.filter((key) => {
          if (tagFilter && !key.tags.includes(tagFilter)) return false;
          if (onlyExpiring) return expiryState(key.expiresAt) !== 'none';
          return true;
        });
        return [...filtered].sort((a, b) => {
          if (sort === 'name') return a.label.localeCompare(b.label);
          if (sort === 'expiry') {
            const left = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
            const right = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
            return left - right;
          }
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
      },
    [sort, onlyExpiring],
  );

  if (!workspace) return null;

  const scopedKeys = folder ? folder.keys : data.keys;
  const keys = sortKeys(scopedKeys);
  const title = folder ? folder.name : tier === 'critical' ? 'Critical' : 'Standard';
  const hint = folder
    ? (folder.note ?? `${folder.keyCount} ${folder.keyCount === 1 ? 'key' : 'keys'} in this folder`)
    : tier === 'critical'
      ? 'A second password and three encryption layers.'
      : 'Unlocked by your master password.';

  function touchCritical() {
    if (tier === 'critical' && workspace?.criticalUnlocked) {
      void api.touchCritical().catch(() => undefined);
    }
  }

  function openNewKey() {
    touchCritical();
    setKeyDialog({ open: true, entry: null });
  }

  function openNewFolder() {
    touchCritical();
    setFolderDialog({ open: true, folder: null });
  }

  function requestDeleteKey(entry: KeyView) {
    setDeleteTarget({ kind: 'key', id: entry.id, name: entry.label, keyCount: 1 });
  }

  function requestDeleteFolder(target: FolderView) {
    setDeleteTarget({
      kind: 'folder',
      id: target.id,
      name: target.name,
      keyCount: target.keyCount,
    });
  }

  async function reorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ids = data.folders.map((candidate) => candidate.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    try {
      await reorderFolders(tier, ids);
    } catch (caught) {
      toast(errorMessage(caught), 'error');
    }
  }

  function folderDrop(event: DragEvent, target: FolderView) {
    event.preventDefault();
    setDragFolder(null);
    const keyId = event.dataTransfer.getData('application/x-keyfold-key');
    if (keyId) {
      void moveKey(keyId, tier, target.id).catch((caught) => toast(errorMessage(caught), 'error'));
      return;
    }
    const folderId = event.dataTransfer.getData('application/x-keyfold-folder');
    if (folderId) void reorder(folderId, target.id);
  }

  return (
    <div className="relative flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[960px] px-8 py-7">
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {folder ? (
              <button
                type="button"
                onClick={() => selectFolder(null)}
                className="mb-2 inline-flex items-center gap-1 text-[11.5px] text-text-2 hover:text-text-0"
              >
                <ArrowLeft size={12} />
                {tier === 'critical' ? 'Critical' : 'Standard'}
              </button>
            ) : (
              <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-2">
                {tier === 'critical' ? <Lock size={11} /> : <Shield size={11} />}
                {tier === 'critical' ? 'Critical tier' : 'Standard tier'}
              </div>
            )}
            <div className="flex items-center gap-3">
              {folder ? <FolderGlyph icon={folder.icon} color={folder.color} size={34} /> : null}
              <h1 className="truncate text-[28px] font-medium tracking-heading text-text-0">
                {title}
              </h1>
              {folder ? (
                <div className="flex items-center gap-0.5">
                  <IconButton
                    icon={Pencil}
                    label="Edit folder"
                    onClick={() => setFolderDialog({ open: true, folder })}
                  />
                  <IconButton
                    icon={Trash2}
                    label="Delete folder"
                    tone="danger"
                    onClick={() => requestDeleteFolder(folder)}
                  />
                </div>
              ) : null}
              {tier === 'critical' &&
              workspace.criticalUnlocked &&
              session.criticalLockInSeconds !== null ? (
                <span className="tabular inline-flex items-center gap-1.5 rounded-full border border-[color:var(--critical-border)] bg-critical-bg px-2.5 py-1 text-[11px] text-critical">
                  <Lock size={10} />
                  Locks in {formatCountdown(session.criticalLockInSeconds)}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[12.5px] text-text-2">
              {locked ? 'Enter the second password to open this tier.' : hint}
            </p>
          </div>

          {!locked ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex h-8 items-center gap-2 rounded-sm border border-line bg-transparent px-2.5 text-[12px] text-text-2 hover:border-line-strong hover:text-text-0"
              >
                <Search size={13} />
                Search
                <Kbd>Ctrl K</Kbd>
              </button>
              <Select
                value={sort}
                onChange={(value) => setSort(value)}
                options={[
                  { value: 'updated', label: 'Recently updated' },
                  { value: 'name', label: 'Name A–Z' },
                  { value: 'expiry', label: 'Expiry date' },
                ]}
                label="Sort keys"
                className="h-8 w-[150px] text-[12px]"
              />
              <button
                type="button"
                aria-pressed={onlyExpiring}
                onClick={() => setOnlyExpiring((value) => !value)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-[12px]',
                  onlyExpiring
                    ? 'border-[color:var(--accent-border)] bg-accent-bg text-accent'
                    : 'border-line bg-transparent text-text-2 hover:text-text-0',
                )}
              >
                <CalendarClock size={13} />
                Expiring
              </button>
              {tagFilter ? (
                <button
                  type="button"
                  onClick={() => setTagFilter(null)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-[color:var(--critical-border)] bg-critical-bg px-2.5 text-[12px] text-critical"
                >
                  <X size={12} /> {tagFilter}
                </button>
              ) : null}
              <div
                className="flex rounded-sm border border-line bg-bg-2 p-0.5"
                role="group"
                aria-label="View mode"
              >
                <button
                  type="button"
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-sm',
                    viewMode === 'list'
                      ? 'bg-accent-bg text-accent'
                      : 'text-text-2 hover:text-text-1',
                  )}
                >
                  <List size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Card view"
                  aria-pressed={viewMode === 'cards'}
                  onClick={() => setViewMode('cards')}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-sm',
                    viewMode === 'cards'
                      ? 'bg-accent-bg text-accent'
                      : 'text-text-2 hover:text-text-1',
                  )}
                >
                  <LayoutGrid size={14} />
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {locked ? (
          <CriticalGate />
        ) : folder ? (
          <section>
            {folder.keys.length === 0 ? (
              <EmptyState
                icon={KeyRound}
                title="This folder is empty"
                description={`Add the first key to ${folder.name}, like "Production — main app".`}
                action={
                  <Button variant="primary" icon={Plus} onClick={openNewKey}>
                    Add key
                  </Button>
                }
              />
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-text-2">
                    {keys.length} of {folder.keys.length} keys
                  </span>
                </div>
                <KeyCollection
                  keys={keys}
                  tier={tier}
                  viewMode={viewMode}
                  folderName={folder.name}
                  onEdit={(entry) => setKeyDialog({ open: true, entry })}
                  onMove={setMoveEntry}
                  onDelete={requestDeleteKey}
                  onTagClick={setTagFilter}
                />
                <button
                  type="button"
                  onClick={openNewKey}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-sm border border-dashed border-line py-2.5 text-[12.5px] text-text-2 transition-colors hover:border-line-strong hover:text-text-0"
                >
                  <Plus size={14} /> Add key to {folder.name}
                </button>
              </>
            )}
          </section>
        ) : (
          <div className="space-y-8">
            <section>
              <div className="mb-2.5 flex items-center justify-between px-1">
                <h2 className="text-[11px] font-medium uppercase tracking-wider text-text-2">
                  Folders
                </h2>
                <button
                  type="button"
                  onClick={openNewFolder}
                  className="inline-flex items-center gap-1 text-[11.5px] text-text-2 hover:text-text-0"
                >
                  <FolderPlus size={12} /> New folder
                </button>
              </div>
              {data.folders.length === 0 ? (
                <EmptyState
                  icon={FolderPlus}
                  title="No folders yet"
                  description="Press + to create one, like “OpenAI” or “Stripe”. Folders keep related keys together."
                  action={
                    <Button variant="primary" icon={Plus} onClick={openNewFolder}>
                      New folder
                    </Button>
                  }
                />
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                  {data.folders.map((item) => (
                    <FolderTile
                      key={item.id}
                      folder={item}
                      active={selectedFolderId === item.id}
                      dragging={dragFolder === item.id}
                      onOpen={() => selectFolder(item.id)}
                      onDragStart={() => setDragFolder(item.id)}
                      onDragEnd={() => setDragFolder(null)}
                      onDragOver={(event) => {
                        if (
                          event.dataTransfer.types.includes('application/x-keyfold-key') ||
                          event.dataTransfer.types.includes('application/x-keyfold-folder')
                        ) {
                          event.preventDefault();
                        }
                      }}
                      onDrop={(event) => folderDrop(event, item)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-2.5 flex items-center justify-between px-1">
                <h2 className="text-[11px] font-medium uppercase tracking-wider text-text-2">
                  Keys without a folder
                </h2>
                {keys.length > 0 ? (
                  <span className="text-[11px] text-text-2">{keys.length}</span>
                ) : null}
              </div>
              {keys.length === 0 ? (
                <EmptyState
                  icon={KeyRound}
                  title="No standalone keys"
                  description={
                    data.folders.length > 0
                      ? 'Every key is tucked into a folder. Press + to add a standalone key, or open a folder.'
                      : 'Press + to add your first key. You can also create a folder for keys that belong together.'
                  }
                  action={
                    <Button variant="primary" icon={Plus} onClick={openNewKey}>
                      New key
                    </Button>
                  }
                />
              ) : (
                <KeyCollection
                  keys={keys}
                  tier={tier}
                  viewMode={viewMode}
                  folderName={null}
                  onEdit={(entry) => setKeyDialog({ open: true, entry })}
                  onMove={setMoveEntry}
                  onDelete={requestDeleteKey}
                  onTagClick={setTagFilter}
                />
              )}
            </section>
          </div>
        )}
      </div>

      {!locked ? (
        <PlusMenu
          onNewFolder={openNewFolder}
          onNewKey={() => {
            setPlusOpen(false);
            openNewKey();
          }}
        />
      ) : null}

      <FolderDialog
        open={folderDialog.open}
        onOpenChange={(open) =>
          setFolderDialog({ open, folder: open ? folderDialog.folder : null })
        }
        tier={tier}
        folder={folderDialog.folder}
      />
      <KeyDialog
        open={keyDialog.open}
        onOpenChange={(open) => setKeyDialog({ open, entry: open ? keyDialog.entry : null })}
        tier={tier}
        defaultFolderId={selectedFolderId}
        entry={keyDialog.entry}
        folders={data.folders}
      />
      <MoveDialog
        open={moveEntry !== null}
        onOpenChange={(open) => {
          if (!open) setMoveEntry(null);
        }}
        entry={moveEntry}
        tier={tier}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={
          deleteTarget?.kind === 'folder'
            ? `Delete folder “${deleteTarget.name}”?`
            : `Delete “${deleteTarget?.name ?? 'key'}”?`
        }
        description={
          deleteTarget?.kind === 'folder'
            ? deleteTarget.keyCount > 0
              ? `This folder contains ${deleteTarget.keyCount} ${deleteTarget.keyCount === 1 ? 'key' : 'keys'}. Deleting it removes those keys too.`
              : 'This folder is empty. This cannot be undone.'
            : 'The key will be removed from the vault. This cannot be undone.'
        }
        confirmLabel={deleteTarget?.kind === 'folder' ? 'Delete folder' : 'Delete key'}
        requireText={
          deleteTarget?.kind === 'folder' && deleteTarget.keyCount > 0
            ? deleteTarget.name
            : undefined
        }
        onConfirm={async () => {
          if (!deleteTarget) return;
          if (deleteTarget.kind === 'folder') {
            await deleteFolder(deleteTarget.id, deleteTarget.name);
          } else {
            await deleteKey(deleteTarget.id);
          }
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

function KeyCollection({
  keys,
  tier,
  viewMode,
  folderName,
  onEdit,
  onMove,
  onDelete,
  onTagClick,
}: {
  keys: KeyView[];
  tier: Tier;
  viewMode: 'list' | 'cards';
  folderName: string | null;
  onEdit: (entry: KeyView) => void;
  onMove: (entry: KeyView) => void;
  onDelete: (entry: KeyView) => void;
  onTagClick: (tag: string) => void;
}) {
  if (viewMode === 'cards') {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {keys.map((entry) => (
          <KeyItem
            key={entry.id}
            entry={entry}
            tier={tier}
            folderName={folderName}
            variant="card"
            onEdit={() => onEdit(entry)}
            onMove={() => onMove(entry)}
            onDelete={() => onDelete(entry)}
            onTagClick={onTagClick}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-bg-1">
      {keys.map((entry) => (
        <KeyItem
          key={entry.id}
          entry={entry}
          tier={tier}
          folderName={folderName}
          variant="row"
          onEdit={() => onEdit(entry)}
          onMove={() => onMove(entry)}
          onDelete={() => onDelete(entry)}
          onTagClick={onTagClick}
        />
      ))}
    </div>
  );
}

function FolderTile({
  folder,
  active,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  folder: FolderView;
  active: boolean;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}) {
  const hex = folderHex(folder.color);
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-keyfold-folder', folder.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'group relative',
        dragging && 'opacity-50',
        active && 'ring-1 ring-[color:var(--accent-border)]',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col items-start rounded-lg border border-line bg-bg-1 p-4 text-left transition-colors hover:border-line-strong hover:bg-bg-2"
      >
        <div className="flex w-full items-start justify-between">
          <FolderGlyph icon={folder.icon} color={folder.color} size={36} />
          <ChevronRight
            size={14}
            className="mt-1 text-text-2 transition-transform group-hover:translate-x-0.5"
          />
        </div>
        <span className="mt-3 w-full truncate text-[13px] font-medium text-text-0">
          {folder.name}
        </span>
        <span className="mt-0.5 text-[11.5px] text-text-2">
          {folder.keyCount} {folder.keyCount === 1 ? 'key' : 'keys'}
        </span>
        <span className="mt-2.5 h-1 w-7 rounded-full" style={{ background: hex }} aria-hidden />
      </button>
    </div>
  );
}

import { Lock, PanelLeftClose, PanelLeftOpen, Settings, Shield, Unlock } from 'lucide-react';
import { useState, type DragEvent } from 'react';

import { Badge, IconButton, Kbd, Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatCountdown } from '@/lib/format';
import type { FolderView, Tier } from '@/lib/types';
import { useApp } from '@/store/app';
import { FolderGlyph } from './glyphs';

function acceptKeyDrop(event: DragEvent): boolean {
  return event.dataTransfer.types.includes('application/x-keyfold-key');
}

export function Sidebar() {
  const workspace = useApp((state) => state.workspace);
  const selectedTier = useApp((state) => state.selectedTier);
  const selectedFolderId = useApp((state) => state.selectedFolderId);
  const selectTier = useApp((state) => state.selectTier);
  const selectFolder = useApp((state) => state.selectFolder);
  const collapsed = useApp((state) => state.sidebarCollapsed);
  const toggleSidebar = useApp((state) => state.toggleSidebar);
  const setSettingsOpen = useApp((state) => state.setSettingsOpen);
  const lock = useApp((state) => state.lock);
  const lockCritical = useApp((state) => state.lockCritical);
  const session = useApp((state) => state.session);
  const moveKey = useApp((state) => state.moveKey);
  const toast = useApp((state) => state.toast);
  const [dropFolder, setDropFolder] = useState<string | null>(null);

  if (!workspace) return null;

  const critical = workspace.critical;
  const criticalUnlocked = workspace.criticalUnlocked;

  function tierButton(tier: Tier) {
    const active = selectedTier === tier && selectedFolderId === null;
    const isCritical = tier === 'critical';
    const count = tier === 'standard' ? workspace?.standard.keyCount : critical?.keyCount;
    return (
      <button
        type="button"
        onClick={() => selectTier(tier)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'keyfold-nav-row flex w-full items-center gap-2.5 rounded-sm border border-transparent px-2.5 py-2 text-[13px] transition-colors',
          active
            ? isCritical
              ? 'bg-critical-bg text-critical shadow-[inset_2px_0_0_var(--critical)]'
              : 'accent-rail bg-accent-bg text-accent'
            : 'text-text-1 hover:bg-bg-3 hover:text-text-0',
          collapsed && 'justify-center px-0',
        )}
        title={collapsed ? tier : undefined}
      >
        {isCritical ? <Lock size={15} aria-hidden /> : <Shield size={15} aria-hidden />}
        {!collapsed ? (
          <>
            <span className="flex-1 text-left font-medium">
              {isCritical ? 'Critical' : 'Standard'}
            </span>
            {isCritical && criticalUnlocked && session.criticalLockInSeconds !== null ? (
              <span className="tabular rounded-full border border-[color:var(--critical-border)] px-1.5 py-0.5 text-[10px] text-critical">
                {formatCountdown(session.criticalLockInSeconds)}
              </span>
            ) : (
              <span className="tabular text-[11px] text-text-2">{count ?? 0}</span>
            )}
          </>
        ) : null}
      </button>
    );
  }

  function folderRow(folder: FolderView, tier: Tier) {
    const isCritical = tier === 'critical';
    const active = selectedTier === tier && selectedFolderId === folder.id;
    const isDropTarget = dropFolder === folder.id;
    return (
      <div
        key={folder.id}
        onDragOver={(event) => {
          if (!acceptKeyDrop(event)) return;
          event.preventDefault();
          setDropFolder(folder.id);
        }}
        onDragLeave={() => setDropFolder((current) => (current === folder.id ? null : current))}
        onDrop={(event) => {
          if (!acceptKeyDrop(event)) return;
          event.preventDefault();
          setDropFolder(null);
          const keyId = event.dataTransfer.getData('application/x-keyfold-key');
          if (!keyId) return;
          void moveKey(keyId, tier, folder.id).catch((caught) =>
            toast(errorMessage(caught), 'error'),
          );
        }}
        className={cn(
          'rounded-sm transition-colors',
          isDropTarget && (isCritical ? 'bg-critical-bg' : 'bg-accent-bg'),
        )}
      >
        <button
          type="button"
          onClick={() => {
            selectTier(tier);
            selectFolder(folder.id);
          }}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'keyfold-nav-row flex w-full items-center gap-2 rounded-sm py-1.5 pl-2 pr-2 text-[12.5px] transition-colors',
            collapsed ? 'justify-center' : 'pl-7',
            active
              ? 'bg-bg-3 text-text-0 shadow-[inset_2px_0_0_var(--accent)]'
              : 'text-text-2 hover:bg-bg-3 hover:text-text-1',
          )}
          title={collapsed ? folder.name : undefined}
        >
          <FolderGlyph icon={folder.icon} color={folder.color} size={collapsed ? 22 : 18} />
          {!collapsed ? (
            <>
              <span className="flex-1 truncate text-left">{folder.name}</span>
              <span className="tabular text-[10.5px] text-text-2">{folder.keyCount}</span>
            </>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-line-subtle bg-bg-1 transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-[260px]',
      )}
    >
      <div
        className={cn(
          'flex items-center px-3 pb-2 pt-3',
          collapsed ? 'justify-center' : 'justify-between',
        )}
      >
        {!collapsed ? (
          <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-2">
            Vault
          </span>
        ) : null}
        <IconButton
          icon={collapsed ? PanelLeftOpen : PanelLeftClose}
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={toggleSidebar}
          size={14}
        />
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        <section className="space-y-1">
          {tierButton('standard')}
          {!collapsed
            ? workspace.standard.folders.map((folder) => folderRow(folder, 'standard'))
            : null}
        </section>

        <section className="space-y-1">
          {tierButton('critical')}
          {!collapsed && criticalUnlocked ? (
            (critical?.folders ?? []).length > 0 ? (
              critical?.folders.map((folder) => folderRow(folder, 'critical'))
            ) : (
              <p className="px-2 pl-7 text-[11px] text-text-2">No Critical folders yet.</p>
            )
          ) : null}
          {!collapsed && !criticalUnlocked ? (
            <p className="px-2 pl-7 text-[11px] leading-relaxed text-text-2">
              Locked until the second password is entered.
            </p>
          ) : null}
        </section>
      </nav>

      <div className="space-y-0.5 border-t border-line-subtle p-2">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={cn(
            'keyfold-nav-row flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-[12.5px] text-text-2 hover:bg-bg-3 hover:text-text-0',
            collapsed && 'justify-center px-0',
          )}
          title={collapsed ? 'Settings' : undefined}
        >
          <Settings size={15} />
          {!collapsed ? (
            <>
              <span className="flex-1 text-left">Settings</span>
              <Kbd>Ctrl ,</Kbd>
            </>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => void lock()}
          className={cn(
            'keyfold-nav-row flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-[12.5px] text-text-2 hover:bg-bg-3 hover:text-text-0',
            collapsed && 'justify-center px-0',
          )}
          title={collapsed ? 'Lock vault' : undefined}
        >
          <Lock size={15} />
          {!collapsed ? (
            <>
              <span className="flex-1 text-left">Lock vault</span>
              <Kbd>Ctrl L</Kbd>
            </>
          ) : null}
        </button>
        {criticalUnlocked ? (
          <button
            type="button"
            onClick={() => void lockCritical()}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-[12.5px] text-text-2 hover:bg-critical-bg hover:text-critical',
              collapsed && 'justify-center px-0',
            )}
            title={collapsed ? 'Lock Critical tier' : undefined}
          >
            <Unlock size={15} />
            {!collapsed ? (
              <>
                <span className="flex-1 text-left">Lock Critical only</span>
                <Kbd>Ctrl ⇧ L</Kbd>
              </>
            ) : null}
          </button>
        ) : null}
        {!collapsed ? (
          <div className="px-2.5 pt-2">
            <Badge
              tone={criticalUnlocked ? 'critical' : 'neutral'}
              icon={criticalUnlocked ? Unlock : Lock}
            >
              {criticalUnlocked ? 'Critical unlocked' : 'Critical locked'}
            </Badge>
          </div>
        ) : (
          <Tooltip content={criticalUnlocked ? 'Critical unlocked' : 'Critical locked'}>
            <span
              className={cn(
                'mx-auto mb-1 mt-2 block h-1.5 w-1.5 rounded-full',
                criticalUnlocked ? 'bg-critical' : 'bg-text-2',
              )}
            />
          </Tooltip>
        )}
      </div>
    </aside>
  );
}

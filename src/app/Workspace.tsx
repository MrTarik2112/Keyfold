import { useEffect } from 'react';

import { CommandPalette } from '@/features/search/CommandPalette';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { Content } from '@/features/vault/Content';
import { Sidebar } from '@/features/vault/Sidebar';
import { api } from '@/lib/ipc';
import { useApp } from '@/store/app';

export function Workspace() {
  const refreshSession = useApp((state) => state.refreshSession);
  const setSearchOpen = useApp((state) => state.setSearchOpen);
  const setPlusOpen = useApp((state) => state.setPlusOpen);
  const setSettingsOpen = useApp((state) => state.setSettingsOpen);
  const lock = useApp((state) => state.lock);
  const lockCritical = useApp((state) => state.lockCritical);
  const criticalUnlocked = useApp((state) => state.workspace?.criticalUnlocked ?? false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshSession();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [refreshSession]);

  useEffect(() => {
    let last = 0;
    const activity = () => {
      const now = Date.now();
      if (now - last < 10_000) return;
      last = now;
      // Only the Standard session follows general workspace activity. The
      // Critical tier keeps its own, much shorter timer and is extended only
      // by actual Critical operations.
      void api.touch().catch(() => undefined);
    };
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    return () => {
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.repeat) {
        if (event.key === 'Escape') {
          setPlusOpen(false);
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      } else if (key === 'n') {
        event.preventDefault();
        setPlusOpen(true);
      } else if (key === 'l' && event.shiftKey) {
        event.preventDefault();
        if (criticalUnlocked) void lockCritical();
      } else if (key === 'l') {
        event.preventDefault();
        void lock();
      } else if (key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [criticalUnlocked, lock, lockCritical, setPlusOpen, setSearchOpen, setSettingsOpen]);

  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar />
      <Content />
      <SettingsDialog />
      <CommandPalette />
    </div>
  );
}

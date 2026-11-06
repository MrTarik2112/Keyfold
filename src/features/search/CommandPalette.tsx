import * as Dialog from '@radix-ui/react-dialog';
import { CornerDownLeft, Folder, KeyRound, Lock, Search, Shield } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';

import { Kbd } from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { api } from '@/lib/ipc';
import type { SearchHit } from '@/lib/types';
import { useApp } from '@/store/app';

export function CommandPalette() {
  const open = useApp((state) => state.searchOpen);
  const setOpen = useApp((state) => state.setSearchOpen);
  const selectTier = useApp((state) => state.selectTier);
  const selectFolder = useApp((state) => state.selectFolder);
  const toast = useApp((state) => state.toast);
  const criticalUnlocked = useApp((state) => state.workspace?.criticalUnlocked ?? false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setActive(0);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const needle = query.trim();
    if (!needle) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .search(needle)
        .then((hits) => {
          setResults(hits);
          setActive(0);
        })
        .catch((caught) => toast(errorMessage(caught), 'error'))
        .finally(() => setLoading(false));
    }, 160);
    return () => window.clearTimeout(timer);
  }, [query, open, toast]);

  function choose(hit: SearchHit | undefined) {
    if (!hit) return;
    selectTier(hit.tier);
    selectFolder(hit.folderId);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, Math.max(0, results.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active]);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[14%] z-[56] w-[calc(100vw_-_32px)] max-w-[560px] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-bg-1 shadow-sm">
          <Dialog.Title className="sr-only">Search keys</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search Standard keys, and Critical keys once unlocked.
          </Dialog.Description>
          <div className="flex items-center gap-2.5 border-b border-line-subtle px-4">
            <Search size={16} className="text-text-2" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search keys, providers, folders…"
              aria-label="Search keys"
              className="h-12 flex-1 bg-transparent text-[14px] text-text-1 outline-none placeholder:text-text-2"
            />
            <Kbd>Esc</Kbd>
          </div>

          <div className="max-h-[340px] overflow-y-auto p-1.5">
            {query.trim().length === 0 ? (
              <div className="px-3 py-8 text-center">
                <p className="text-[12.5px] text-text-2">
                  Search by label, provider, tag or folder name.
                </p>
                <p className="mt-1.5 text-[11.5px] text-text-2">
                  {criticalUnlocked
                    ? 'Standard and Critical keys are included.'
                    : 'Critical keys stay hidden until that tier is unlocked.'}
                </p>
              </div>
            ) : results.length === 0 ? (
              <p className="px-3 py-8 text-center text-[12.5px] text-text-2">
                {loading ? 'Searching…' : 'No keys match that search.'}
              </p>
            ) : (
              results.map((hit, index) => (
                <button
                  key={hit.id}
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(hit)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left',
                    index === active ? 'bg-bg-3' : 'hover:bg-bg-3',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-xs border',
                      hit.tier === 'critical'
                        ? 'border-[color:var(--critical-border)] bg-critical-bg text-critical'
                        : 'border-line bg-bg-3 text-accent',
                    )}
                  >
                    {hit.tier === 'critical' ? <Lock size={13} /> : <Shield size={13} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] text-text-0">{hit.label}</span>
                      {hit.provider ? (
                        <span className="truncate text-[11px] text-text-2">{hit.provider}</span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-2">
                      {hit.folderName ? (
                        <>
                          <Folder size={10} />
                          {hit.folderName}
                        </>
                      ) : (
                        <>
                          <KeyRound size={10} />
                          No folder
                        </>
                      )}
                      <span aria-hidden>·</span>
                      <span className="capitalize">{hit.tier}</span>
                    </span>
                  </span>
                  {index === active ? <CornerDownLeft size={13} className="text-text-2" /> : null}
                </button>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-line-subtle px-4 py-2 text-[10.5px] text-text-2">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd> open
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

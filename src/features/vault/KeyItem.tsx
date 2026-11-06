import { CalendarClock, Check, Copy, Eye, EyeOff, MoveRight, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';

import { Badge, IconButton, Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { expiryState, formatDate, formatRelative } from '@/lib/format';
import { api } from '@/lib/ipc';
import type { KeyView, Tier } from '@/lib/types';
import { useApp } from '@/store/app';
import { ProviderMark } from './glyphs';

interface KeyItemProps {
  entry: KeyView;
  tier: Tier;
  folderName?: string | null;
  variant: 'row' | 'card';
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
  draggable?: boolean;
}

export function KeyItem({
  entry,
  tier,
  folderName,
  variant,
  onEdit,
  onMove,
  onDelete,
  draggable = true,
}: KeyItemProps) {
  const copySecret = useApp((state) => state.copySecret);
  const toast = useApp((state) => state.toast);
  const secretsEpoch = useApp((state) => state.secretsEpoch);
  const [secret, setSecret] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(10);
  const [copied, setCopied] = useState(false);
  const revealButton = useRef<HTMLButtonElement>(null);
  const expiry = expiryState(entry.expiresAt);

  // Wipe a revealed value whenever the window loses focus, the vault locks,
  // or the Critical tier re-locks. A secret should never survive a context
  // switch or a lock event on screen.
  useEffect(() => {
    setSecret(null);
  }, [secretsEpoch]);

  useEffect(() => {
    if (secret === null) return;
    setSeconds(10);
    const timer = window.setInterval(() => {
      setSeconds((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          setSecret(null);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    const hide = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSecret(null);
        revealButton.current?.focus();
      }
    };
    window.addEventListener('keydown', hide);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', hide);
    };
  }, [secret]);

  async function toggleReveal() {
    if (secret !== null) {
      setSecret(null);
      return;
    }
    try {
      setSecret(await api.getSecret(entry.id));
    } catch (caught) {
      toast(errorMessage(caught), 'error');
    }
  }

  async function copy() {
    try {
      await copySecret(entry.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (caught) {
      toast(errorMessage(caught), 'error');
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      const selected = window.getSelection()?.toString();
      if (selected) return;
      event.preventDefault();
      void copy();
    }
  }

  function onDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData('application/x-keyfold-key', entry.id);
    event.dataTransfer.setData('text/plain', entry.id);
    event.dataTransfer.effectAllowed = 'move';
  }

  const meta = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-text-2">
      {entry.provider ? <span className="text-text-1">{entry.provider}</span> : null}
      {folderName ? (
        <>
          {entry.provider ? <span aria-hidden>·</span> : null}
          <span>{folderName}</span>
        </>
      ) : null}
      <span aria-hidden>·</span>
      <span>Created {formatDate(entry.createdAt)}</span>
      {entry.lastCopiedAt ? (
        <>
          <span aria-hidden>·</span>
          <span>Copied {formatRelative(entry.lastCopiedAt)}</span>
        </>
      ) : null}
      {entry.tags.slice(0, variant === 'card' ? 2 : 3).map((tag) => (
        <span key={tag} className="rounded bg-bg-3 px-1.5 py-0.5 text-[10.5px] text-text-2">
          {tag}
        </span>
      ))}
    </div>
  );

  const actions = (
    <div className="flex items-center gap-0.5">
      <IconButton
        ref={revealButton}
        icon={secret !== null ? EyeOff : Eye}
        label={secret !== null ? 'Hide value' : 'Reveal value'}
        onClick={() => void toggleReveal()}
        active={secret !== null}
      />
      <IconButton icon={copied ? Check : Copy} label="Copy value" onClick={() => void copy()} />
      <IconButton icon={Pencil} label="Edit key" onClick={onEdit} />
      <IconButton icon={MoveRight} label="Move key" onClick={onMove} />
      <IconButton icon={Trash2} label="Delete key" tone="danger" onClick={onDelete} />
    </div>
  );

  const expiryBadge =
    expiry === 'expired' ? (
      <Badge tone="critical" icon={CalendarClock}>
        Expired {formatDate(entry.expiresAt)}
      </Badge>
    ) : expiry === 'soon' ? (
      <Badge tone="warning" icon={CalendarClock}>
        Expires {formatDate(entry.expiresAt)}
      </Badge>
    ) : null;

  const valueLine =
    secret !== null ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="secret select-all break-all text-[12.5px] text-text-0">{secret}</span>
        <span className="tabular text-[10.5px] text-text-2">Hides in {seconds}s</span>
      </div>
    ) : (
      <span className="secret text-[12.5px] text-text-2">{entry.hint}</span>
    );

  if (variant === 'card') {
    return (
      <div
        tabIndex={0}
        role="group"
        aria-label={`Key ${entry.label}`}
        draggable={draggable}
        onDragStart={onDragStart}
        onKeyDown={onKeyDown}
        className="keyfold-card group flex flex-col rounded-lg border border-line bg-bg-1 p-4 transition-colors hover:border-line-strong hover:bg-bg-2 focus-within:border-line-strong"
      >
        <div className="flex items-start justify-between gap-2">
          <ProviderMark provider={entry.provider} size={32} />
          <div className="opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {actions}
          </div>
        </div>
        <div className="mt-3 min-w-0">
          <p className="truncate text-[13.5px] font-medium text-text-0">{entry.label}</p>
          <div className="mt-1.5">{valueLine}</div>
        </div>
        <div className="mt-3 border-t border-line-subtle pt-2.5">
          {meta}
          {expiryBadge ? <div className="mt-2">{expiryBadge}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={`Key ${entry.label}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onKeyDown={onKeyDown}
      className="keyfold-row group flex items-center gap-3 border-b border-line-subtle px-4 py-3 transition-colors last:border-b-0 hover:bg-bg-2 focus-within:bg-bg-2"
    >
      <ProviderMark provider={entry.provider} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-text-0">{entry.label}</span>
          {expiryBadge}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">{valueLine}</div>
        <div className="mt-1">{meta}</div>
      </div>
      <div className="shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100">
        <Tooltip content={tier === 'critical' ? 'Critical key' : 'Standard key'}>
          <span
            className={cn(
              'mr-1 hidden h-1.5 w-1.5 rounded-full sm:block',
              tier === 'critical' ? 'bg-critical' : 'bg-accent',
            )}
            aria-hidden
          />
        </Tooltip>
        {actions}
      </div>
    </div>
  );
}

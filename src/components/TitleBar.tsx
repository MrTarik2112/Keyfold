import { getCurrentWindow } from '@tauri-apps/api/window';
import { Maximize2, Minus, X } from 'lucide-react';

import { cn } from '@/lib/cn';
import { isTauriRuntime } from '@/lib/ipc';
import { Badge } from './ui';

function control(action: 'minimize' | 'maximize' | 'close'): void {
  if (!isTauriRuntime()) return;
  const window = getCurrentWindow();
  if (action === 'minimize') void window.minimize();
  if (action === 'maximize') void window.toggleMaximize();
  if (action === 'close') void window.close();
}

const buttonClass =
  'no-drag flex h-10 w-[46px] items-center justify-center text-text-2 transition-colors';

export function TitleBar({ compact = false }: { compact?: boolean }) {
  const preview = !isTauriRuntime() && import.meta.env.DEV;
  return (
    <header
      data-tauri-drag-region
      className={cn(
        'drag-region flex h-10 shrink-0 select-none items-center justify-between border-b border-line-subtle bg-bg-0 pl-4',
        compact && 'bg-transparent',
      )}
    >
      <div className="flex items-center gap-2.5" data-tauri-drag-region>
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-2">
          Keyfold
        </span>
        {preview ? <Badge tone="neutral">UI preview</Badge> : null}
      </div>
      <div className="flex h-full items-stretch">
        <button
          type="button"
          className={cn(buttonClass, 'hover:bg-bg-3 hover:text-text-0')}
          aria-label="Minimize window"
          onClick={() => control('minimize')}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className={cn(buttonClass, 'hover:bg-bg-3 hover:text-text-0')}
          aria-label="Maximize window"
          onClick={() => control('maximize')}
        >
          <Maximize2 size={12} />
        </button>
        <button
          type="button"
          className={cn(buttonClass, 'hover:bg-critical hover:text-[#08090a]')}
          aria-label="Close window"
          onClick={() => control('close')}
        >
          <X size={15} />
        </button>
      </div>
    </header>
  );
}

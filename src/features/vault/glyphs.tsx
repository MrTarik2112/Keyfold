import { Folder } from 'lucide-react';

import { PROVIDER_PRESETS } from '@/lib/constants';
import { FOLDER_ICONS, folderHex } from './folder-icons';

export function FolderGlyph({
  icon,
  color,
  size = 36,
}: {
  icon: string;
  color: string;
  size?: number;
}) {
  const Icon = FOLDER_ICONS[icon] ?? Folder;
  const hex = folderHex(color);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-sm border"
      style={{
        width: size,
        height: size,
        color: hex,
        background: `${hex}14`,
        borderColor: `${hex}2e`,
      }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.46)} strokeWidth={1.8} />
    </span>
  );
}

function initials(provider: string): string {
  const words = provider.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '•';
  if (words.length === 1) {
    const word = words[0] ?? '';
    return word.slice(0, 2).toUpperCase();
  }
  return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
}

/** Neutral monogram — deliberately not a trademarked logo. */
export function ProviderMark({ provider, size = 30 }: { provider: string | null; size?: number }) {
  const preset = PROVIDER_PRESETS.find((candidate) => candidate.id === provider);
  const mark = preset?.mark ?? (provider ? initials(provider) : '•');
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-sm border border-line bg-bg-3 font-medium text-text-1"
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.3)) }}
      aria-hidden
    >
      {mark}
    </span>
  );
}

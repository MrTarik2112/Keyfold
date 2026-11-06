export const FOLDER_COLORS = [
  { id: 'indigo', value: '#6366f1' },
  { id: 'emerald', value: '#27a644' },
  { id: 'amber', value: '#e4f222' },
  { id: 'rose', value: '#eb5757' },
  { id: 'cyan', value: '#02b8cc' },
  { id: 'slate', value: '#8a8f98' },
] as const;

export const FOLDER_ICONS = [
  'folder',
  'terminal',
  'cloud',
  'database',
  'sparkles',
  'code',
  'globe',
  'shield',
  'box',
  'brain',
] as const;

export const PROVIDER_PRESETS = [
  { id: 'OpenAI', mark: 'OA' },
  { id: 'Anthropic', mark: 'AN' },
  { id: 'Google', mark: 'G' },
  { id: 'GitHub', mark: 'GH' },
  { id: 'Stripe', mark: 'S' },
  { id: 'AWS', mark: 'AWS' },
  { id: 'Cloudflare', mark: 'CF' },
  { id: 'Generic', mark: '•' },
] as const;

export const AUTO_LOCK_OPTIONS = [
  { value: 1, label: '1 minute' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 0, label: 'Never (not recommended)' },
];

export const CRITICAL_LOCK_OPTIONS = [
  { value: 30, label: '30 seconds' },
  { value: 60, label: '60 seconds' },
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
];

export const CLIPBOARD_OPTIONS = [
  { value: 10, label: '10 seconds' },
  { value: 20, label: '20 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '60 seconds' },
];

export function folderColor(value: string): string {
  return FOLDER_COLORS.find((color) => color.id === value)?.value ?? FOLDER_COLORS[0].value;
}

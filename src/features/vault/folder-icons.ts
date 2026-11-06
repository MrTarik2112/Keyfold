import {
  Box,
  Brain,
  Cloud,
  Code2,
  Database,
  Folder,
  Globe2,
  Shield,
  Sparkles,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

import { FOLDER_COLORS } from '@/lib/constants';

export const FOLDER_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  terminal: Terminal,
  cloud: Cloud,
  database: Database,
  sparkles: Sparkles,
  code: Code2,
  globe: Globe2,
  shield: Shield,
  box: Box,
  brain: Brain,
};

export const FOLDER_ICON_OPTIONS = Object.entries(FOLDER_ICONS).map(([id, Icon]) => ({ id, Icon }));

export function folderHex(color: string): string {
  return FOLDER_COLORS.find((candidate) => candidate.id === color)?.value ?? FOLDER_COLORS[0].value;
}

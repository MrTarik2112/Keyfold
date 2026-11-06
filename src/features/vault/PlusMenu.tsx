import * as Popover from '@radix-ui/react-popover';
import { motion } from 'framer-motion';
import { FolderPlus, KeyRound, Plus } from 'lucide-react';

import { useApp } from '@/store/app';

export function PlusMenu({
  onNewFolder,
  onNewKey,
}: {
  onNewFolder: () => void;
  onNewKey: () => void;
}) {
  const open = useApp((state) => state.plusOpen);
  const setOpen = useApp((state) => state.setPlusOpen);
  const tier = useApp((state) => state.selectedTier);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor className="fixed bottom-8 right-8 z-30">
        <Popover.Trigger asChild>
          <motion.button
            type="button"
            aria-label="Create"
            aria-expanded={open}
            animate={{ rotate: open ? 45 : 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="flex h-[48px] w-[48px] items-center justify-center rounded-full bg-accent text-[#08090a] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Plus size={22} strokeWidth={2.2} />
          </motion.button>
        </Popover.Trigger>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={12}
          className="z-40 w-[248px] rounded-lg border border-line bg-bg-1 p-1.5 shadow-sm outline-none"
        >
          {[
            {
              icon: FolderPlus,
              title: 'New Folder',
              description: 'Group keys for one provider or project.',
              action: onNewFolder,
            },
            {
              icon: KeyRound,
              title: 'New Key',
              description: `Store a secret in ${tier === 'critical' ? 'Critical' : 'Standard'}.`,
              action: onNewKey,
            },
          ].map((item, index) => (
            <motion.button
              key={item.title}
              type="button"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.03 * index, duration: 0.14 }}
              onClick={() => {
                setOpen(false);
                item.action();
              }}
              className="flex w-full items-start gap-3 rounded-sm p-2.5 text-left transition-colors hover:bg-bg-3"
            >
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-sm border border-line bg-bg-3 text-accent">
                <item.icon size={15} />
              </span>
              <span>
                <span className="block text-[13px] font-medium text-text-0">{item.title}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-text-2">
                  {item.description}
                </span>
              </span>
            </motion.button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

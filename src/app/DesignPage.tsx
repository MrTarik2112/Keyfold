import {
  ArrowRight,
  Copy,
  Eye,
  FolderPlus,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  Shield,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';

import { TitleBar } from '@/components/TitleBar';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  Logo,
  Modal,
  PasswordInput,
  Select,
  Switch,
  Textarea,
  Toasts,
  TooltipProvider,
} from '@/components/ui';
import { FOLDER_COLORS } from '@/lib/constants';
import { useApp } from '@/store/app';
import { FolderGlyph, ProviderMark } from '@/features/vault/glyphs';

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-2">{title}</h2>
      <div className="rounded-lg border border-line bg-bg-1 p-4">{children}</div>
    </section>
  );
}

/** Development-only component gallery: `/design` in a dev build. */
export function DesignPage() {
  const toast = useApp((state) => state.toast);
  const [modal, setModal] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);
  const [select, setSelect] = useState('one');
  const [password, setPassword] = useState('correct horse battery staple 42');
  const [text, setText] = useState('');

  return (
    <TooltipProvider>
      <div className="flex min-h-full flex-col bg-bg-0">
        <TitleBar compact />
        <div className="mx-auto w-full max-w-[960px] space-y-8 px-8 py-8">
          <header>
            <p className="text-[10.5px] uppercase tracking-[0.14em] text-text-2">Design system</p>
            <h1 className="mt-1 text-[32px] font-medium tracking-display">Keyfold components</h1>
            <p className="mt-1 text-[13px] text-text-2">
              Every base component in its default, hover, focus and disabled states.
            </p>
          </header>

          <Block title="Brand">
            <div className="flex items-center gap-4">
              <span className="text-accent">
                <Logo size={56} />
              </span>
              <div>
                <p className="text-[18px] font-medium tracking-heading">Keyfold</p>
                <p className="text-[12.5px] text-text-2">Every key, folded away safely.</p>
              </div>
            </div>
          </Block>

          <Block title="Buttons">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={Plus}>
                Primary
              </Button>
              <Button variant="secondary" icon={Copy}>
                Secondary
              </Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger" icon={Trash2}>
                Danger
              </Button>
              <Button variant="primary" loading>
                Loading
              </Button>
              <Button variant="secondary" disabled>
                Disabled
              </Button>
              <Button size="sm" icon={ArrowRight}>
                Small
              </Button>
            </div>
            <div className="mt-4 flex items-center gap-1">
              <IconButton icon={Eye} label="Reveal" />
              <IconButton icon={Copy} label="Copy" />
              <IconButton icon={Pencil} label="Edit" />
              <IconButton icon={Trash2} label="Delete" tone="danger" />
            </div>
          </Block>

          <Block title="Inputs">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Text input" hint="Helper text sits below.">
                <Input
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="sk-…"
                />
              </Field>
              <Field label="Invalid input" error="That value is not valid.">
                <Input value="wrong" invalid readOnly />
              </Field>
              <Field label="Password">
                <PasswordInput
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  showStrength
                />
              </Field>
              <Field label="Select">
                <Select
                  value={select}
                  onChange={setSelect}
                  options={[
                    { value: 'one', label: 'Recently updated' },
                    { value: 'two', label: 'Name A–Z' },
                  ]}
                  label="Sample select"
                />
              </Field>
              <Field label="Textarea">
                <Textarea placeholder="Optional notes…" />
              </Field>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-text-1">Switch</span>
                <Switch checked={switchOn} onCheckedChange={setSwitchOn} label="Sample switch" />
              </div>
            </div>
          </Block>

          <Block title="Badges and keys">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">Neutral</Badge>
              <Badge tone="accent" icon={Shield}>
                Standard
              </Badge>
              <Badge tone="critical" icon={Lock}>
                Critical
              </Badge>
              <Badge tone="warning">Expires soon</Badge>
              <Badge tone="success">Copied</Badge>
              <Kbd>Ctrl K</Kbd>
              <span className="tabular rounded-full border border-[color:var(--critical-border)] bg-critical-bg px-2 py-0.5 text-[11px] text-critical">
                Locks in 0:48
              </span>
            </div>
            <div className="mt-4 overflow-hidden rounded-lg border border-line">
              <div className="flex items-center gap-3 px-4 py-3">
                <ProviderMark provider="OpenAI" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">Production — main app</p>
                  <p className="secret text-[12px] text-text-2">sk-••••••••3f9a</p>
                </div>
                <Badge tone="warning">Expires Nov 3</Badge>
                <div className="flex gap-0.5">
                  <IconButton icon={Eye} label="Reveal" />
                  <IconButton icon={Copy} label="Copy" />
                </div>
              </div>
            </div>
            <div className="mt-3 flex gap-3">
              {FOLDER_COLORS.slice(0, 4).map((color) => (
                <div
                  key={color.id}
                  className="flex w-[150px] flex-col rounded-lg border border-line bg-bg-1 p-3"
                >
                  <FolderGlyph icon="terminal" color={color.id} size={32} />
                  <p className="mt-2 text-[12.5px] font-medium">Folder</p>
                  <p className="text-[11px] text-text-2">3 keys</p>
                </div>
              ))}
            </div>
          </Block>

          <Block title="Empty state">
            <EmptyState
              icon={FolderPlus}
              title="No folders yet"
              description="Press + to create one, like “OpenAI” or “Stripe”."
              action={
                <Button variant="primary" icon={Plus}>
                  New folder
                </Button>
              }
            />
          </Block>

          <Block title="Modal and toasts">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setModal(true)}>Open dialog</Button>
              <Button onClick={() => toast('Copied. Clipboard clears in 20s.')}>
                Success toast
              </Button>
              <Button onClick={() => toast('That password is incorrect.', 'error')}>
                Error toast
              </Button>
              <Button onClick={() => toast('Critical tier locked.', 'info')}>Info toast</Button>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[12px] text-text-2">
              <KeyRound size={13} /> Secret values use JetBrains Mono with ligatures disabled.
            </p>
          </Block>
        </div>

        <Modal
          open={modal}
          onOpenChange={setModal}
          title="New key in Standard"
          description="The value is encrypted before it is written to disk."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setModal(false)}>
                Save key
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Label">
              <Input placeholder="Production — main app" />
            </Field>
            <Field label="Value">
              <PasswordInput placeholder="sk-…" />
            </Field>
          </div>
        </Modal>
        <Toasts />
      </div>
    </TooltipProvider>
  );
}

import { Lock, MoveRight } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Button, Field, Input, Modal, PasswordInput, Select, Textarea } from '@/components/ui';
import { FOLDER_COLORS, PROVIDER_PRESETS } from '@/lib/constants';
import { errorMessage } from '@/lib/errors';
import { formatTags } from '@/lib/format';
import type { FolderView, KeyView, Tier } from '@/lib/types';
import { useApp } from '@/store/app';
import { FOLDER_ICON_OPTIONS } from './folder-icons';

/* ------------------------------ folder dialog ----------------------------- */

export function FolderDialog({
  open,
  onOpenChange,
  tier,
  folder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tier: Tier;
  folder?: FolderView | null;
}) {
  const createFolder = useApp((state) => state.createFolder);
  const updateFolder = useApp((state) => state.updateFolder);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('folder');
  const [color, setColor] = useState<string>('indigo');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? '');
    setIcon(folder?.icon ?? 'folder');
    setColor(folder?.color ?? 'indigo');
    setNote(folder?.note ?? '');
    setError(null);
  }, [open, folder]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('Give the folder a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (folder) {
        await updateFolder({ id: folder.id, name, icon, color, note: note || null });
      } else {
        await createFolder({ tier, name, icon, color, note: note || null });
      }
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        folder ? 'Edit folder' : `New folder in ${tier === 'critical' ? 'Critical' : 'Standard'}`
      }
      description="Folders group keys from one provider or project."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="folder-form" loading={busy}>
            {folder ? 'Save changes' : 'Create folder'}
          </Button>
        </>
      }
    >
      <form id="folder-form" onSubmit={submit} className="space-y-4">
        <Field label="Name" htmlFor="folder-name">
          <Input
            id="folder-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="OpenAI"
            maxLength={80}
          />
        </Field>

        <div className="space-y-1.5">
          <span className="block text-[12px] font-medium text-text-1">Icon</span>
          <div className="flex flex-wrap gap-1.5">
            {FOLDER_ICON_OPTIONS.map(({ id, Icon }) => (
              <button
                key={id}
                type="button"
                aria-label={`Icon ${id}`}
                aria-pressed={icon === id}
                onClick={() => setIcon(id)}
                className={
                  icon === id
                    ? 'inline-flex h-9 w-9 items-center justify-center rounded-sm border border-[color:var(--accent-border)] bg-accent-bg text-accent'
                    : 'inline-flex h-9 w-9 items-center justify-center rounded-sm border border-line bg-bg-3 text-text-2 hover:text-text-0'
                }
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-[12px] font-medium text-text-1">Color</span>
          <div className="flex gap-2">
            {FOLDER_COLORS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-label={`Color ${candidate.id}`}
                aria-pressed={color === candidate.id}
                onClick={() => setColor(candidate.id)}
                className={
                  color === candidate.id
                    ? 'h-7 w-7 rounded-full ring-2 ring-text-0 ring-offset-2 ring-offset-bg-2'
                    : 'h-7 w-7 rounded-full opacity-70 hover:opacity-100'
                }
                style={{ background: candidate.value }}
              />
            ))}
          </div>
        </div>

        <Field label="Note (optional)" htmlFor="folder-note">
          <Textarea
            id="folder-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What belongs in this folder?"
            maxLength={400}
          />
        </Field>

        {error ? <p className="text-[12.5px] text-critical">{error}</p> : null}
      </form>
    </Modal>
  );
}

/* -------------------------------- key dialog ------------------------------ */

export function KeyDialog({
  open,
  onOpenChange,
  tier,
  defaultFolderId,
  entry,
  folders,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tier: Tier;
  defaultFolderId: string | null;
  entry?: KeyView | null;
  folders: FolderView[];
}) {
  const createKey = useApp((state) => state.createKey);
  const updateKey = useApp((state) => state.updateKey);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [folderId, setFolderId] = useState('none');
  const [provider, setProvider] = useState('');
  const [tags, setTags] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel(entry?.label ?? '');
    setValue('');
    setFolderId(entry?.folderId ?? defaultFolderId ?? 'none');
    setProvider(entry?.provider ?? '');
    setTags(entry?.tags.join(', ') ?? '');
    setExpiresAt(entry?.expiresAt?.slice(0, 10) ?? '');
    setNote(entry?.note ?? '');
    setError(null);
  }, [open, entry, defaultFolderId]);

  const folderOptions = useMemo(
    () => [
      { value: 'none', label: 'No folder' },
      ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
    ],
    [folders],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!label.trim()) {
      setError('Give the key a label.');
      return;
    }
    if (!entry && !value) {
      setError('Paste the key value.');
      return;
    }
    if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      setError('Use YYYY-MM-DD for the expiry date.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (entry) {
        await updateKey({
          id: entry.id,
          label,
          value: value || null,
          note: note || null,
          provider: provider || null,
          tags: formatTags(tags),
          expiresAt: expiresAt || null,
        });
      } else {
        await createKey({
          tier,
          folderId: folderId === 'none' ? null : folderId,
          label,
          value,
          note: note || null,
          provider: provider || null,
          tags: formatTags(tags),
          expiresAt: expiresAt || null,
        });
      }
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      tone={tier === 'critical' ? 'critical' : 'default'}
      title={entry ? 'Edit key' : `New key in ${tier === 'critical' ? 'Critical' : 'Standard'}`}
      description={
        entry
          ? 'Editing the value re-encrypts it with fresh key material.'
          : 'The value is encrypted before it is written to disk.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="key-form" loading={busy}>
            {entry ? 'Save changes' : 'Save key'}
          </Button>
        </>
      }
    >
      <form id="key-form" onSubmit={submit} className="space-y-4">
        <div className={entry ? 'space-y-4' : 'grid grid-cols-[1fr_200px] gap-3'}>
          <Field label="Label" htmlFor="key-label">
            <Input
              id="key-label"
              autoFocus
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Production — main app"
              maxLength={120}
            />
          </Field>
          {!entry ? (
            <Field label="Folder" htmlFor="key-folder">
              <Select
                value={folderId}
                onChange={setFolderId}
                options={folderOptions}
                label="Folder"
              />
            </Field>
          ) : null}
        </div>

        <Field
          label={entry ? 'New value (leave empty to keep current)' : 'Key value'}
          htmlFor="key-value"
        >
          <PasswordInput
            id="key-value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={entry ? 'Leave empty to keep the current value' : 'sk-…'}
            autoComplete="off"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Provider (optional)" htmlFor="key-provider">
            <Input
              id="key-provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              placeholder="OpenAI"
              list="provider-presets"
            />
            <datalist id="provider-presets">
              {PROVIDER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id} />
              ))}
            </datalist>
          </Field>
          <Field label="Expires on (optional)" htmlFor="key-expiry" hint="YYYY-MM-DD">
            <Input
              id="key-expiry"
              inputMode="numeric"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              placeholder="2027-01-31"
              maxLength={10}
            />
          </Field>
        </div>

        <Field label="Tags (comma separated)" htmlFor="key-tags">
          <Input
            id="key-tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="billing, production"
          />
        </Field>

        <Field label="Note (optional)" htmlFor="key-note">
          <Textarea
            id="key-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Rotation owner, usage limits, anything useful."
            maxLength={1000}
          />
        </Field>

        {error ? <p className="text-[12.5px] text-critical">{error}</p> : null}
      </form>
    </Modal>
  );
}

/* ------------------------------- move dialog ------------------------------ */

export function MoveDialog({
  open,
  onOpenChange,
  entry,
  tier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: KeyView | null;
  tier: Tier;
}) {
  const moveKey = useApp((state) => state.moveKey);
  const workspace = useApp((state) => state.workspace);
  const [targetTier, setTargetTier] = useState<Tier>('standard');
  const [targetFolder, setTargetFolder] = useState('none');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargetTier(tier);
    setTargetFolder('none');
    setError(null);
  }, [open, tier]);

  const folders =
    targetTier === 'critical'
      ? (workspace?.critical?.folders ?? [])
      : (workspace?.standard.folders ?? []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!entry) return;
    setBusy(true);
    setError(null);
    try {
      await moveKey(entry.id, targetTier, targetFolder === 'none' ? null : targetFolder);
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Move key"
      description={
        entry
          ? `"${entry.label}" will be re-encrypted for the target tier.`
          : 'Choose where the key should live.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="move-form"
            icon={MoveRight}
            loading={busy}
            disabled={targetTier === 'critical' && !workspace?.criticalUnlocked}
          >
            Move key
          </Button>
        </>
      }
    >
      <form id="move-form" onSubmit={submit} className="space-y-4">
        <Field label="Tier">
          <div className="grid grid-cols-2 gap-2">
            {(['standard', 'critical'] as Tier[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => {
                  setTargetTier(candidate);
                  setTargetFolder('none');
                }}
                className={
                  targetTier === candidate
                    ? candidate === 'critical'
                      ? 'flex items-center gap-2 rounded-sm border border-[color:var(--critical-border)] bg-critical-bg px-3 py-2.5 text-left text-[13px] text-critical'
                      : 'flex items-center gap-2 rounded-sm border border-[color:var(--accent-border)] bg-accent-bg px-3 py-2.5 text-left text-[13px] text-accent'
                    : 'flex items-center gap-2 rounded-sm border border-line bg-bg-3 px-3 py-2.5 text-left text-[13px] text-text-2 hover:text-text-0'
                }
              >
                {candidate === 'critical' ? <Lock size={14} /> : null}
                <span className="capitalize">{candidate}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Folder">
          <Select
            value={targetFolder}
            onChange={setTargetFolder}
            options={[
              { value: 'none', label: 'No folder' },
              ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
            ]}
            label="Target folder"
          />
        </Field>

        {targetTier === 'critical' && !workspace?.criticalUnlocked ? (
          <p className="text-[12px] leading-relaxed text-warning">
            Unlock the Critical tier before moving keys into it.
          </p>
        ) : null}

        {error ? <p className="text-[12.5px] text-critical">{error}</p> : null}
      </form>
    </Modal>
  );
}

/* ------------------------------ confirm dialog ---------------------------- */

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  requireText,
  onConfirm,
  tone = 'danger',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  requireText?: string;
  onConfirm: () => Promise<void>;
  tone?: 'danger' | 'default';
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText('');
    setError(null);
  }, [open]);

  const matches = !requireText || text.trim() === requireText;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      tone={tone === 'danger' ? 'critical' : 'default'}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => void confirm()}
            loading={busy}
            disabled={!matches}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {requireText ? (
          <Field label={`Type "${requireText}" to confirm`}>
            <Input value={text} onChange={(event) => setText(event.target.value)} autoFocus />
          </Field>
        ) : null}
        {error ? <p className="text-[12.5px] text-critical">{error}</p> : null}
      </div>
    </Modal>
  );
}

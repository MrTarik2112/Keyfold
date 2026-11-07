import { open, save } from '@tauri-apps/plugin-dialog';
import {
  Activity,
  Check,
  ClipboardCopy,
  Database,
  Download,
  FolderOpen,
  Info,
  KeyRound,
  MonitorOff,
  Palette,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { Badge, Button, Field, Input, Modal, PasswordInput, Select, Switch } from '@/components/ui';
import { copyRecoveryKey } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { AUTO_LOCK_OPTIONS, CLIPBOARD_OPTIONS, CRITICAL_LOCK_OPTIONS } from '@/lib/constants';
import { errorMessage } from '@/lib/errors';
import { saveRecoveryKeyFile } from '@/lib/files';
import { api, isTauriRuntime } from '@/lib/ipc';
import { passwordStrength } from '@/lib/password';
import type { KdfParams, Settings } from '@/lib/types';
import { useApp } from '@/store/app';

type Tab = 'security' | 'appearance' | 'data' | 'about';

export function SettingsDialog() {
  const openSettings = useApp((state) => state.settingsOpen);
  const setOpen = useApp((state) => state.setSettingsOpen);
  const settings = useApp((state) => state.settings);
  const saveSettings = useApp((state) => state.saveSettings);
  const toast = useApp((state) => state.toast);
  const [tab, setTab] = useState<Tab>('security');
  const [local, setLocal] = useState<Settings | null>(settings);

  useEffect(() => {
    if (openSettings) setLocal(settings);
  }, [openSettings, settings]);

  function update(patch: Partial<Settings>) {
    if (!local) return;
    const next = { ...local, ...patch };
    setLocal(next);
    void saveSettings(next).catch((caught) => toast(errorMessage(caught), 'error'));
  }

  const tabs: { id: Tab; label: string; icon: typeof Shield }[] = [
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'data', label: 'Data', icon: Database },
    { id: 'about', label: 'About', icon: Info },
  ];

  return (
    <Modal open={openSettings} onOpenChange={setOpen} title="Settings" width="lg">
      <div className="flex min-h-[420px] gap-5">
        <nav className="w-[132px] shrink-0 space-y-0.5" aria-label="Settings sections">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => setTab(item.id)}
              className={
                tab === item.id
                  ? 'flex w-full items-center gap-2 rounded-sm bg-bg-3 px-2.5 py-2 text-[12.5px] text-text-0'
                  : 'flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-[12.5px] text-text-2 hover:bg-bg-3 hover:text-text-1'
              }
            >
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="max-h-[62vh] min-w-0 flex-1 overflow-y-auto pr-1">
          {!local ? (
            <p className="text-[12.5px] text-text-2">
              Settings are unavailable while the vault is locked.
            </p>
          ) : tab === 'security' ? (
            <SecurityTab settings={local} update={update} />
          ) : tab === 'appearance' ? (
            <AppearanceTab settings={local} update={update} />
          ) : tab === 'data' ? (
            <DataTab />
          ) : (
            <AboutTab />
          )}
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-5 py-3">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-text-0">{label}</p>
        {hint ? <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-2">{hint}</p> : null}
      </div>
      <div className="w-[180px] shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-2">
        {title}
      </h3>
      <div className="divide-y divide-line-subtle border-y border-line-subtle">{children}</div>
    </section>
  );
}

function SecurityTab({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  const workspace = useApp((state) => state.workspace);
  const kdf = useApp((state) => state.kdf);
  return (
    <div className="space-y-6">
      <ProtectionStatus settings={settings} kdf={kdf} />

      <Section title="Locking">
        <Row label="Lock the vault after" hint="Idle time before Standard and Critical close.">
          <Select
            value={settings.autoLockMinutes}
            onChange={(value) => update({ autoLockMinutes: value })}
            options={AUTO_LOCK_OPTIONS}
            label="Auto-lock delay"
          />
        </Row>
        <Row label="Lock Critical after" hint="Always separate from the Standard session.">
          <Select
            value={settings.criticalAutoLockSeconds}
            onChange={(value) => update({ criticalAutoLockSeconds: value })}
            options={CRITICAL_LOCK_OPTIONS}
            label="Critical auto-lock delay"
          />
        </Row>
        <Row
          label="Clear clipboard after"
          hint="Only if the clipboard still holds the copied value."
        >
          <Select
            value={settings.clipboardClearSeconds}
            onChange={(value) => update({ clipboardClearSeconds: value })}
            options={CLIPBOARD_OPTIONS}
            label="Clipboard clear delay"
          />
        </Row>
        <Row label="Lock when minimized" hint="Closes both tiers when the window is minimized.">
          <div className="flex justify-end">
            <Switch
              checked={settings.lockOnMinimize}
              onCheckedChange={(value) => update({ lockOnMinimize: value })}
              label="Lock when minimized"
            />
          </div>
        </Row>
        <Row
          label="Block screen capture"
          hint="Ask the OS to exclude this window from screenshots and screen sharing where supported."
        >
          <div className="flex items-center justify-end gap-2">
            <MonitorOff size={14} className="text-text-2" aria-hidden />
            <Switch
              checked={settings.screenCaptureProtected}
              onCheckedChange={(value) => update({ screenCaptureProtected: value })}
              label="Block screen capture"
            />
          </div>
        </Row>
      </Section>

      <ChangePasswords criticalUnlocked={workspace?.criticalUnlocked ?? false} />
      <RecoverySection criticalUnlocked={workspace?.criticalUnlocked ?? false} />
      <ArgonSection kdf={kdf} criticalUnlocked={workspace?.criticalUnlocked ?? false} />
    </div>
  );
}

function ProtectionStatus({ settings, kdf }: { settings: Settings; kdf: KdfParams | null }) {
  return (
    <div className="rounded-lg border border-line bg-bg-0 p-4">
      <div className="flex items-center gap-2 text-accent">
        <ShieldCheck size={15} aria-hidden />
        <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-2">
          Protection status
        </span>
      </div>
      <h2 className="mt-2 text-[18px] font-medium tracking-heading text-text-0">
        Hardened by default.
      </h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-text-2">
        Argon2id, layered AEAD ciphers and a single offline vault. Critical actions stay on a
        shorter leash.
      </p>
      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
        <StatusLine
          label="Screen capture"
          value={settings.screenCaptureProtected ? 'Blocked' : 'Allowed'}
          ok={settings.screenCaptureProtected}
        />
        <StatusLine
          label="Critical idle lock"
          value={`${settings.criticalAutoLockSeconds}s`}
          ok={settings.criticalAutoLockSeconds <= 60}
        />
        <StatusLine
          label="Clipboard"
          value={`Clears in ${settings.clipboardClearSeconds}s`}
          ok={settings.clipboardClearSeconds <= 30}
        />
        <StatusLine
          label="Argon2id"
          value={
            kdf ? `${Math.round(kdf.memoryKib / 1024)} MiB · ${kdf.iterations} passes` : 'Tuned'
          }
          ok
        />
      </div>
    </div>
  );
}

function StatusLine({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-line-subtle bg-bg-1 px-2.5 py-1.5">
      <span className="text-[11px] text-text-2">{label}</span>{' '}
      <span
        className={cn(
          'flex items-center gap-1.5 text-[11px]',
          ok ? 'text-accent' : 'text-critical',
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-accent' : 'bg-critical')} />
        {value}
      </span>
    </div>
  );
}

function ChangePasswords({ criticalUnlocked }: { criticalUnlocked: boolean }) {
  const changeMaster = useApp((state) => state.changeMaster);
  const changeCritical = useApp((state) => state.changeCritical);
  const [masterCurrent, setMasterCurrent] = useState('');
  const [masterNext, setMasterNext] = useState('');
  const [masterConfirm, setMasterConfirm] = useState('');
  const [masterError, setMasterError] = useState<string | null>(null);
  const [masterBusy, setMasterBusy] = useState(false);

  const [criticalCurrent, setCriticalCurrent] = useState('');
  const [criticalNext, setCriticalNext] = useState('');
  const [criticalConfirm, setCriticalConfirm] = useState('');
  const [criticalError, setCriticalError] = useState<string | null>(null);
  const [criticalBusy, setCriticalBusy] = useState(false);

  async function submitMaster(event: FormEvent) {
    event.preventDefault();
    if (masterNext !== masterConfirm) {
      setMasterError('The two new passwords do not match.');
      return;
    }
    if (!passwordStrength(masterNext).acceptable) {
      setMasterError('Choose a stronger password (score 3 or higher, 12+ characters).');
      return;
    }
    setMasterBusy(true);
    setMasterError(null);
    try {
      await changeMaster(masterCurrent, masterNext);
      setMasterCurrent('');
      setMasterNext('');
      setMasterConfirm('');
    } catch (caught) {
      setMasterError(errorMessage(caught));
    } finally {
      setMasterBusy(false);
    }
  }

  async function submitCritical(event: FormEvent) {
    event.preventDefault();
    if (criticalNext !== criticalConfirm) {
      setCriticalError('The two new passwords do not match.');
      return;
    }
    if (!passwordStrength(criticalNext).acceptable) {
      setCriticalError('Choose a stronger password (score 3 or higher, 12+ characters).');
      return;
    }
    setCriticalBusy(true);
    setCriticalError(null);
    try {
      await changeCritical(criticalCurrent, criticalNext);
      setCriticalCurrent('');
      setCriticalNext('');
      setCriticalConfirm('');
    } catch (caught) {
      setCriticalError(errorMessage(caught));
    } finally {
      setCriticalBusy(false);
    }
  }

  return (
    <Section title="Passwords">
      <div className="py-3">
        <p className="mb-3 text-[12.5px] font-medium text-text-0">Change the Standard password</p>
        {!criticalUnlocked ? (
          <p className="mb-3 text-[11.5px] leading-relaxed text-warning">
            Unlock the Critical tier first. The Critical key is wrapped with both passwords, so it
            must be re-wrapped when either one changes.
          </p>
        ) : null}
        <form onSubmit={submitMaster} className="space-y-2.5">
          <PasswordInput
            aria-label="Current Standard password"
            placeholder="Current Standard password"
            value={masterCurrent}
            onChange={(event) => setMasterCurrent(event.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <PasswordInput
              aria-label="New Standard password"
              placeholder="New password"
              value={masterNext}
              onChange={(event) => setMasterNext(event.target.value)}
            />
            <PasswordInput
              aria-label="Confirm new Standard password"
              placeholder="Confirm new password"
              value={masterConfirm}
              onChange={(event) => setMasterConfirm(event.target.value)}
            />
          </div>
          {masterError ? <p className="text-[12px] text-critical">{masterError}</p> : null}
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              loading={masterBusy}
              disabled={!masterCurrent || !masterNext || !criticalUnlocked}
            >
              Change Standard password
            </Button>
          </div>
        </form>
      </div>

      <div className="py-3">
        <p className="mb-3 text-[12.5px] font-medium text-text-0">Change the Critical password</p>
        <form onSubmit={submitCritical} className="space-y-2.5">
          <PasswordInput
            aria-label="Current Critical password"
            placeholder="Current Critical password"
            value={criticalCurrent}
            onChange={(event) => setCriticalCurrent(event.target.value)}
            disabled={!criticalUnlocked}
          />
          <div className="grid grid-cols-2 gap-2">
            <PasswordInput
              aria-label="New Critical password"
              placeholder="New password"
              value={criticalNext}
              onChange={(event) => setCriticalNext(event.target.value)}
              disabled={!criticalUnlocked}
            />
            <PasswordInput
              aria-label="Confirm new Critical password"
              placeholder="Confirm new password"
              value={criticalConfirm}
              onChange={(event) => setCriticalConfirm(event.target.value)}
              disabled={!criticalUnlocked}
            />
          </div>
          {criticalError ? <p className="text-[12px] text-critical">{criticalError}</p> : null}
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              loading={criticalBusy}
              disabled={!criticalCurrent || !criticalNext || !criticalUnlocked}
            >
              Change Critical password
            </Button>
          </div>
        </form>
        {criticalNext && passwordStrength(criticalNext).warning ? (
          <p className="mt-2 text-[11.5px] text-warning">
            {passwordStrength(criticalNext).warning}
          </p>
        ) : null}
        {criticalNext === masterNext && criticalNext ? (
          <p className="mt-2 text-[11.5px] text-critical">The two passwords must be different.</p>
        ) : null}
      </div>
    </Section>
  );
}

function RecoverySection({ criticalUnlocked }: { criticalUnlocked: boolean }) {
  const regenerate = useApp((state) => state.regenerateRecovery);
  const toast = useApp((state) => state.toast);
  const [openDialog, setOpenDialog] = useState(false);
  const [master, setMaster] = useState('');
  const [critical, setCritical] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setNewKey(await regenerate(master, critical));
      setMaster('');
      setCritical('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Recovery">
      <div className="py-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[12.5px] font-medium text-text-0">Recovery key</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-2">
              Replaces the saved key. The old key stops working immediately.
            </p>
          </div>{' '}
          <Button
            size="sm"
            icon={RefreshCw}
            disabled={!criticalUnlocked}
            onClick={() => setOpenDialog(true)}
          >
            Regenerate
          </Button>
        </div>
      </div>

      <Modal
        open={openDialog}
        onOpenChange={setOpenDialog}
        title="Regenerate recovery key"
        description="Both passwords are required. The new key is shown once."
        footer={
          newKey ? (
            <Button variant="primary" onClick={() => setOpenDialog(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpenDialog(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" form="recovery-regen" loading={busy}>
                Generate new key
              </Button>
            </>
          )
        }
      >
        {newKey ? (
          <div className="space-y-3">
            <div className="rounded-sm border border-line bg-bg-0 p-4">
              <p className="secret select-all break-all text-[13px] leading-relaxed text-text-0">
                {newKey}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                icon={copied ? Check : ClipboardCopy}
                className="flex-1"
                onClick={() => {
                  void copyRecoveryKey(newKey)
                    .then((clears) => {
                      setCopied(true);
                      toast(
                        clears
                          ? `Recovery key copied. Clipboard clears in ${clears}s.`
                          : 'Recovery key copied.',
                      );
                    })
                    .catch((caught) => toast(errorMessage(caught), 'error'));
                }}
              >
                Copy
              </Button>
              <Button
                icon={Download}
                className="flex-1"
                onClick={() => {
                  void saveRecoveryKeyFile(newKey).catch((caught) =>
                    toast(errorMessage(caught), 'error'),
                  );
                }}
              >
                Save to file
              </Button>
            </div>
            <p className="text-[11.5px] leading-relaxed text-warning">
              Store it now. It will not be shown again.
            </p>
          </div>
        ) : (
          <form id="recovery-regen" onSubmit={submit} className="space-y-3">
            <Field label="Standard password">
              <PasswordInput
                autoFocus
                value={master}
                onChange={(event) => setMaster(event.target.value)}
                placeholder="Master password"
              />
            </Field>
            <Field label="Critical password">
              <PasswordInput
                value={critical}
                onChange={(event) => setCritical(event.target.value)}
                placeholder="Critical password"
              />
            </Field>
            {error ? <p className="text-[12.5px] text-critical">{error}</p> : null}
          </form>
        )}
      </Modal>
    </Section>
  );
}

function ArgonSection({
  kdf,
  criticalUnlocked,
}: {
  kdf: KdfParams | null;
  criticalUnlocked: boolean;
}) {
  const retune = useApp((state) => state.retune);
  const [openDialog, setOpenDialog] = useState(false);
  const [master, setMaster] = useState('');
  const [critical, setCritical] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<KdfParams | null>(null);
  const params = latest ?? kdf;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setLatest(await retune(master, critical));
      setMaster('');
      setCritical('');
      setOpenDialog(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Key derivation">
      <div className="py-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[12.5px] font-medium text-text-0">Argon2id cost</p>
            <p className="mt-0.5 text-[11.5px] text-text-2">
              {params
                ? `${Math.round(params.memoryKib / 1024)} MiB · ${params.iterations} passes · parallelism ${params.parallelism}`
                : 'Unavailable until the vault exists.'}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-2">
              Tuned for this machine to take roughly 0.7–1.5 seconds per unlock.
            </p>
          </div>
          <Button
            size="sm"
            icon={RefreshCw}
            disabled={!criticalUnlocked}
            onClick={() => setOpenDialog(true)}
          >
            Re-tune
          </Button>
        </div>
      </div>

      <Modal
        open={openDialog}
        onOpenChange={setOpenDialog}
        title="Re-tune Argon2id"
        description="Key derivation runs again with both passwords, then the wrapped keys are rebuilt. This can take a few seconds."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpenDialog(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="retune-form" loading={busy}>
              Measure and re-tune
            </Button>
          </>
        }
      >
        <form id="retune-form" onSubmit={submit} className="space-y-3">
          <Field label="Standard password">
            <PasswordInput
              autoFocus
              value={master}
              onChange={(event) => setMaster(event.target.value)}
              placeholder="Master password"
            />
          </Field>
          <Field label="Critical password">
            <PasswordInput
              value={critical}
              onChange={(event) => setCritical(event.target.value)}
              placeholder="Critical password"
            />
          </Field>
          {error ? <p className="text-[12.5px] text-critical">{error}</p> : null}
        </form>
      </Modal>
    </Section>
  );
}

function AppearanceTab({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  return (
    <div className="space-y-6">
      <Section title="Comfort">
        <Row label="Compact mode" hint="Tighter spacing for more keys on screen.">
          <div className="flex justify-end">
            <Switch
              checked={settings.compactMode}
              onCheckedChange={(value) => update({ compactMode: value })}
              label="Compact mode"
            />
          </div>
        </Row>
        <Row label="Reduce motion" hint="Replaces movement with simple fades.">
          <div className="flex justify-end">
            <Switch
              checked={settings.reduceMotion}
              onCheckedChange={(value) => update({ reduceMotion: value })}
              label="Reduce motion"
            />
          </div>
        </Row>
      </Section>

      <div className="rounded-lg border border-line bg-bg-0 p-4">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-2">Preview</p>
        <div className="mt-2 flex items-center gap-3">
          <span className="inline-flex items-center rounded-xs border border-line bg-bg-3 px-2 py-0.5 text-[10px] text-text-1">
            OA
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] text-text-0">Production — main app</p>
            <p className="secret text-[11.5px] text-text-2">sk-••••••••3f9a</p>
          </div>
          <Badge tone="accent">Standard</Badge>
        </div>
      </div>
    </div>
  );
}

function DataTab() {
  const info = useApp((state) => state.info);
  const importBackup = useApp((state) => state.importBackup);
  const toast = useApp((state) => state.toast);
  const setSettingsOpen = useApp((state) => state.setSettingsOpen);
  const desktop = isTauriRuntime();
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function exportBackup() {
    setBusy(true);
    try {
      const path = await save({
        defaultPath: 'keyfold-backup.vault',
        filters: [{ name: 'Keyfold vault', extensions: ['vault'] }],
      });
      if (!path) return;
      await api.exportBackup(path);
      toast('Encrypted backup written.');
    } catch (caught) {
      toast(errorMessage(caught), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function chooseImport() {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: 'Keyfold vault', extensions: ['vault'] }],
      });
      if (typeof path === 'string') setPendingImport(path);
    } catch (caught) {
      toast(errorMessage(caught), 'error');
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Vault file">
        <div className="py-3">
          <p className="text-[12.5px] font-medium text-text-0">Location</p>
          <p className="secret mt-1 break-all text-[11px] text-text-2">
            {info?.vaultPath ?? 'Unknown'}
          </p>
          <Button
            size="sm"
            icon={FolderOpen}
            className="mt-3"
            disabled={!desktop}
            onClick={() => {
              void api.openVaultLocation().catch((caught) => toast(errorMessage(caught), 'error'));
            }}
          >
            Open folder
          </Button>
          {!desktop ? (
            <p className="mt-2 text-[11px] text-text-2">
              File actions are available in the desktop app. This is a UI preview.
            </p>
          ) : null}
        </div>
      </Section>

      <Section title="Encrypted backups">
        <div className="py-3">
          <p className="text-[12.5px] font-medium text-text-0">Export or import</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-2">
            Backups are the vault file itself and stay encrypted. There is no plaintext export.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              icon={Download}
              disabled={!desktop || busy}
              onClick={() => void exportBackup()}
            >
              Export encrypted backup
            </Button>
            <Button size="sm" icon={Upload} disabled={!desktop} onClick={() => void chooseImport()}>
              Import backup
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Danger zone">
        <div className="py-3">
          <p className="text-[12.5px] font-medium text-text-0">Delete this vault</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-2">
            Removes the vault file and its rolling backup. This cannot be undone.
          </p>
          <Button
            size="sm"
            variant="danger"
            icon={Trash2}
            className="mt-3"
            onClick={() => setDeleteOpen(true)}
          >
            Delete vault
          </Button>
        </div>
      </Section>

      <Modal
        open={pendingImport !== null}
        onOpenChange={(next) => {
          if (!next) setPendingImport(null);
        }}
        title="Replace the current vault?"
        description="The imported file will replace this machine's vault. You will need its passwords to unlock it."
        tone="critical"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingImport(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!pendingImport) return;
                void importBackup(pendingImport)
                  .then(() => {
                    setPendingImport(null);
                    setSettingsOpen(false);
                  })
                  .catch((caught) => toast(errorMessage(caught), 'error'));
              }}
            >
              Import and replace
            </Button>
          </>
        }
      >
        <p className="secret break-all text-[11.5px] text-text-2">{pendingImport}</p>
      </Modal>

      <DeleteVaultDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  );
}

function DeleteVaultDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const deleteVault = useApp((state) => state.deleteVault);
  const setSettingsOpen = useApp((state) => state.setSettingsOpen);
  const [master, setMaster] = useState('');
  const [critical, setCritical] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMaster('');
    setCritical('');
    setConfirm('');
    setError(null);
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await deleteVault(master, critical);
      onOpenChange(false);
      setSettingsOpen(false);
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
      title="Delete this vault"
      description="Every key, folder and setting will be erased. This cannot be undone."
      tone="critical"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            type="submit"
            form="delete-vault-form"
            loading={busy}
            disabled={confirm !== 'DELETE' || !master || !critical}
          >
            Delete vault permanently
          </Button>
        </>
      }
    >
      <form id="delete-vault-form" onSubmit={submit} className="space-y-3">
        <Field label="Standard password">
          <PasswordInput
            autoFocus
            value={master}
            onChange={(event) => setMaster(event.target.value)}
            placeholder="Master password"
          />
        </Field>
        <Field label="Critical password">
          <PasswordInput
            value={critical}
            onChange={(event) => setCritical(event.target.value)}
            placeholder="Critical password"
          />
        </Field>
        <Field label='Type "DELETE" to confirm'>
          <Input value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </Field>
        {error ? <p className="text-[12.5px] text-critical">{error}</p> : null}
      </form>
    </Modal>
  );
}

function AboutTab() {
  const info = useApp((state) => state.info);
  const stats = useApp((state) => state.vaultStats);
  const fetchStats = useApp((state) => state.fetchStats);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  const totalKeys = (stats?.standardKeys ?? 0) + (stats?.criticalKeys ?? 0);
  const totalFolders = (stats?.standardFolders ?? 0) + (stats?.criticalFolders ?? 0);
  const totalTags = stats?.tags.length ?? 0;
  const topTag = stats?.tags[0];

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-sm border border-line bg-bg-3 text-accent">
            <KeyRound size={17} />
          </span>
          <div>
            <p className="text-[14px] font-semibold text-text-0">Keyfold</p>
            <p className="text-[11.5px] text-text-2">Every key, folded away safely.</p>
          </div>
        </div>
      </div>

      <Section title="Build">
        <Row label="Version" hint="Desktop app, local vault only.">
          <p className="text-right text-[12px] text-text-1">{info?.version ?? '0.1.0'}</p>
        </Row>
        <Row label="Vault format" hint="On-disk format version.">
          <p className="text-right text-[12px] text-text-1">v{info?.formatVersion ?? 1}</p>
        </Row>
        <Row label="License" hint="Source-available desktop application.">
          <p className="text-right text-[12px] text-text-1">MIT</p>
        </Row>
      </Section>

      {stats ? (
        <Section title="Vault statistics">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3">
            <StatCard title="Total keys" value={totalKeys} icon={<Activity size={14} className="text-text-1" />} />
            <StatCard title="Total folders" value={totalFolders} icon={<Database size={14} className="text-text-1" />} />
            <StatCard title="Tags" value={totalTags} icon={<TagIcon className="text-text-1" />} />
            <StatCard title="Encryption" value="Argon2id + AEAD" icon={<ShieldCheck size={14} className="text-accent" />} subtitle={false} />
          </div>
          {stats.tags.length > 0 && (
            <div className="mt-4 py-3">
              <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-2 mb-2">Top tags</h3>
              <div className="flex flex-wrap gap-2">
                {stats.tags.slice(0, 8).map((tag: { name: string; count: number }) => (
                  <Badge key={tag.name} tone={tag === topTag ? 'accent' : 'neutral'} className="text-[11px] px-2.5 py-1">
                    {tag.name} <span className="text-text-3">({tag.count})</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Section>
      ) : null}

      <Section title="Keyboard shortcuts">
        <div className="divide-y divide-line-subtle py-3">
          <ShortcutRow keys={['Ctrl', 'K']} label="Search keys" />
          <ShortcutRow keys={['Ctrl', 'N']} label="New key" />
          <ShortcutRow keys={['Escape']} label="Hide revealed value" />
          <ShortcutRow keys={['Ctrl', 'C']} label="Copy selected key value" />
        </div>
      </Section>

      <Section title="Security summary">
        <div className="space-y-2.5 py-3 text-[12px] leading-relaxed text-text-2">
          <p>
            Your master passwords are turned into keys with Argon2id. The vault key and the Critical
            key are wrapped with those derived keys, and every value is encrypted with authenticated
            ciphers before it touches disk.
          </p>
          <p>
            Critical entries add a second password and three independent encryption layers. That is
            defence in depth, not magic: the real protection is the separate password and Argon2id.
          </p>
          <p>
            Keyfold has no network permissions, no accounts and no telemetry. It cannot protect you
            from malware running while the vault is unlocked, or from a keylogger.
          </p>
        </div>
      </Section>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  subtitle = true,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  subtitle?: boolean;
}) {
  return (
    <div className="rounded-sm border border-line bg-bg-1 p-3">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-[rgba(255,255,255,0.02)] text-text-2">
          {icon}
        </div>
        <div>
          <p className="text-[11px] font-medium text-text-0">{value}</p>
          {subtitle ? <p className="text-[10px] text-text-2">{title}</p> : null}
        </div>
      </div>
    </div>
  );
}

function ShortcutRow({
  keys,
  label,
}: {
  keys: string[];
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 px-1">
      <span className="text-[12px] text-text-1">{label}</span>
      <span className="flex gap-1">
        {keys.map((key, i) => (
          <kbd key={i} className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-bg-3 px-1 font-mono text-[10.5px] text-text-2">
            {key}
          </kbd>
        ))}
      </span>
    </div>
  );
}

function TagIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 16l5.59-5.59a2 2 0 0 1 0-2.83z" />
      <path d="M7 7a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

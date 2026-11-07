import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, KeyRound, LifeBuoy, ShieldCheck, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button, Input, PasswordInput } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/store/app';

export function UnlockScreen() {
  const unlock = useApp((state) => state.unlock);
  const unlockRecovery = useApp((state) => state.unlockRecovery);
  const deleteVault = useApp((state) => state.deleteVault);
  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  /* ---------- Hesap sıfırlama / vault silme akışı ---------- */
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState(0); // 0..5 onay, 6 = işlem çalışır
  const [deleteMaster, setDeleteMaster] = useState('');
  const [deleteCritical, setDeleteCritical] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const rateLimited = error?.startsWith('Too many failed attempts') ?? false;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (mode === 'recovery' && recoveryKey.trim().length === 0) {
      setError('Enter your recovery key.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'recovery') {
        await unlockRecovery(recoveryKey);
      } else {
        await unlock(password);
      }
    } catch (caught) {
      setError(errorMessage(caught));
      setAttempt((value) => value + 1);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: 'password' | 'recovery') {
    setMode(next);
    setError(null);
    setPassword('');
    setRecoveryKey('');
  }

  async function handleDeleteConfirm() {
    setDeleteError(null);
    // 6. onayda işlemi çalıştır, öncekiler sayacı artırır
    if (deleteStep < 5) {
      setDeleteStep((value) => value + 1);
      return;
    }
    if (!deleteMaster || !deleteCritical) {
      setDeleteError('Both passwords are required.');
      return;
    }
    setDeleteBusy(true);
    try {
      await deleteVault(deleteMaster, deleteCritical);
      setDeleteOpen(false);
      setDeleteStep(0);
      setDeleteMaster('');
      setDeleteCritical('');
      setDeleteError(null);
    } catch (caught) {
      setDeleteError(errorMessage(caught));
    } finally {
      setDeleteBusy(false);
    }
  }

  function openDeleteFlow() {
    setDeleteOpen(true);
    setDeleteStep(0);
    setDeleteMaster('');
    setDeleteCritical('');
    setDeleteError(null);
  }

  function closeDeleteFlow() {
    setDeleteOpen(false);
    setDeleteStep(0);
    setDeleteMaster('');
    setDeleteCritical('');
    setDeleteError(null);
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-bg-0 px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative w-full max-w-[400px]"
      >
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-bg-1 text-accent">
            <KeyRound size={24} aria-hidden />
          </div>
          <h1 className="text-[24px] font-medium tracking-heading text-text-0">Vault locked.</h1>
          <p className="mt-2 max-w-[300px] text-[13px] leading-relaxed text-text-2">
            {mode === 'password'
              ? 'Enter your master password to open the Standard tier.'
              : 'Use the recovery key you saved when you created this vault.'}
          </p>
        </div>

        <motion.form
          key={attempt}
          onSubmit={submit}
          animate={attempt > 0 ? { x: [0, -6, 6, -4, 4, 0] } : undefined}
          transition={{ duration: 0.25 }}
          className="rounded-lg border border-line bg-bg-1 p-6 shadow-[var(--shadow-inset)]"
        >
          {mode === 'password' ? (
            <PasswordInput
              autoFocus
              aria-label="Master password"
              placeholder="Master password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
          ) : (
            <Input
              autoFocus
              aria-label="Recovery key"
              placeholder="XXXX-XXXX-XXXX-…"
              className="secret h-10 uppercase"
              value={recoveryKey}
              onChange={(event) => setRecoveryKey(event.target.value)}
              disabled={busy}
            />
          )}

          {error ? (
            <p
              role="alert"
              className={
                rateLimited
                  ? 'mt-3 text-[12.5px] leading-relaxed text-warning'
                  : 'mt-3 text-[12.5px] leading-relaxed text-critical'
              }
            >
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={busy}
            disabled={
              deleteOpen ||
              busy ||
              (mode === 'password' ? password.length === 0 : recoveryKey.length === 0)
            }
            className="mt-4 w-full"
          >
            {mode === 'password' ? 'Unlock' : 'Unlock with recovery key'}
            {!busy ? <ArrowRight size={15} /> : null}
          </Button>

          <button
            type="button"
            onClick={() => switchMode(mode === 'password' ? 'recovery' : 'password')}
            disabled={deleteOpen}
            className="mt-4 flex w-full items-center justify-center gap-1.5 text-[12px] text-text-2 transition-colors hover:text-text-0 disabled:opacity-40 disabled:pointer-events-none"
          >
            {mode === 'password' ? <LifeBuoy size={13} /> : <KeyRound size={13} />}
            {mode === 'password' ? 'Use recovery key instead' : 'Use master password instead'}
          </button>

          {/* ---------- Hesap sıfırlama bölümü ---------- */}
          {deleteOpen ? (
            <div className="mt-6 rounded-sm border border-[color:var(--critical-border)] bg-[rgba(235,87,87,0.06)] p-4 shadow-[var(--shadow-inset)]">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle size={14} className="text-critical" />
                <h3 className="text-[13px] font-medium text-critical">Hesabı sıfırla</h3>
              </div>
              <p className="mb-4 text-[12px] leading-relaxed text-text-2">
                Tüm anahtarlar, klasörler ve ayarlar kalıcı olarak silinecektir. Bu işlem geri alınamaz.
              </p>

              <div className="space-y-3 mb-4">
                <PasswordInput
                  aria-label="Standard password"
                  placeholder="Master password"
                  value={deleteMaster}
                  onChange={(event) => setDeleteMaster(event.target.value)}
                  disabled={deleteBusy || deleteStep === 5}
                />
                <PasswordInput
                  aria-label="Critical password"
                  placeholder="Critical password"
                  value={deleteCritical}
                  onChange={(event) => setDeleteCritical(event.target.value)}
                  disabled={deleteBusy || deleteStep === 5}
                />
              </div>

              {deleteError ? (
                <p className="mt-2 text-[12px] leading-relaxed text-critical">{deleteError}</p>
              ) : null}

              <div className="mb-3">
                <span className="block text-[12px] font-medium text-text-1 mb-1.5">
                  Onay ({deleteStep + 1}/6)
                </span>
                <Button
                  variant="danger"
                  size="md"
                  loading={deleteBusy}
                  disabled={
                    deleteBusy ||
                    (deleteStep === 5 && (!deleteMaster || !deleteCritical))
                  }
                  onClick={handleDeleteConfirm}
                  className="w-full"
                >
                  {deleteStep < 5 ? `Evet, eminim (${deleteStep + 2}/6)` : 'Evet, kalıcı olarak sil'}
                </Button>
              </div>

              <button
                type="button"
                onClick={closeDeleteFlow}
                className="mt-3 flex w-full items-center justify-center gap-1.5 text-[11.5px] font-medium text-text-2 transition-colors hover:text-text-0"
              >
                <X size={13} /> İptal et
              </button>
            </div>
          ) : null}

          {/* ---------- Sıfırlama tetikleyici butonu ---------- */}
          <button
            type="button"
            onClick={openDeleteFlow}
            className="mt-4 flex w-full items-center justify-center gap-1.5 text-[11px] font-medium text-critical transition-colors hover:text-critical-hover disabled:opacity-40 disabled:pointer-events-none"
          >
            <Trash2 size={12} /> Hesabı sıfırla / tüm veriyi sil
          </button>
        </motion.form>

        <div className="mt-6 flex items-center justify-center gap-1.5 text-[11.5px] text-text-2">
          <ShieldCheck size={12} />
          Encrypted on this PC. No accounts. No network.
        </div>
      </motion.div>
    </div>
  );
}

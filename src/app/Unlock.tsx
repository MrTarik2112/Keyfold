import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowRight,
  KeyRound,
  LifeBuoy,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button, Input, PasswordInput } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/store/app';

const RESET_CONFIRM_PHRASE = 'I ACCEPT RESPONSIBILITY';

export function UnlockScreen() {
  const unlock = useApp((state) => state.unlock);
  const unlockRecovery = useApp((state) => state.unlockRecovery);
  const resetVault = useApp((state) => state.resetVault);
  const info = useApp((state) => state.info);
  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  /* ---------- Hesap sıfırlama / factory reset akışı (şifre unutulduğunda) ---------- */
  const [resetOpen, setResetOpen] = useState(false);
  const [resetStep, setResetStep] = useState(0); // 0..4 onay, 5 = cümle gir, 6 = işlem
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

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

  async function handleResetNext() {
    setResetError(null);
    if (resetStep < 5) {
      setResetStep((value) => value + 1);
      return;
    }
    if (resetStep === 5) {
      // Cümle onayı
      if (resetConfirm.trim().toUpperCase() !== RESET_CONFIRM_PHRASE) {
        setResetError('Type the phrase exactly: ' + RESET_CONFIRM_PHRASE);
        return;
      }
      setResetStep(6);
      return;
    }
    // resetStep === 6 → işlemi çalıştır
    setResetBusy(true);
    try {
      await resetVault();
      setResetOpen(false);
      setResetStep(0);
      setResetConfirm('');
      setResetError(null);
    } catch (caught) {
      setResetError(errorMessage(caught));
    } finally {
      setResetBusy(false);
    }
  }

  function openResetFlow() {
    setResetOpen(true);
    setResetStep(0);
    setResetConfirm('');
    setResetError(null);
  }

  function closeResetFlow() {
    setResetOpen(false);
    setResetStep(0);
    setResetConfirm('');
    setResetError(null);
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

        {/* ---------- Vault bilgi satırı ---------- */}
        {info && (
          <div className="mb-4 flex items-center justify-between rounded-sm border border-line-subtle bg-[rgba(255,255,255,0.02)] px-3.5 py-2">
            <div className="flex items-center gap-2">
              <ShieldCheck size={12} className="text-text-2" aria-hidden />
              <span className="text-[11px] text-text-2">Encrypted vault</span>
            </div>
            <span className="text-[11px] text-text-2">
              {info.version ? `v${info.version}` : 'Keyfold'}
            </span>
          </div>
        )}

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
              resetOpen ||
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
            disabled={resetOpen}
            className="mt-4 flex w-full items-center justify-center gap-1.5 text-[12px] text-text-2 transition-colors hover:text-text-0 disabled:opacity-40 disabled:pointer-events-none"
          >
            {mode === 'password' ? <LifeBuoy size={13} /> : <KeyRound size={13} />}
            {mode === 'password' ? 'Use recovery key instead' : 'Use master password instead'}
          </button>

          {/* ---------- Şifre unutma / factory reset bölümü ---------- */}
          {resetOpen ? (
            <div className="mt-6 rounded-sm border border-[color:var(--critical-border)] bg-[rgba(235,87,87,0.06)] p-4 shadow-[var(--shadow-inset)]">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle size={14} className="text-critical" />
                <h3 className="text-[13px] font-medium text-critical">Forgot your password?</h3>
              </div>
              <p className="mb-4 text-[12px] leading-relaxed text-text-2">
                Keyfold has no accounts and no network, so a forgotten password cannot be
                recovered. Resetting deletes every key, folder and setting permanently.
              </p>

              {resetStep < 5 ? (
                <>
                  <div className="mb-3">
                    <span className="block text-[12px] font-medium text-text-1 mb-1.5">
                      Confirm reset ({resetStep + 1}/5)
                    </span>
                    <Button
                      variant="danger"
                      size="md"
                      loading={resetBusy}
                      disabled={resetBusy}
                      onClick={handleResetNext}
                      className="w-full"
                    >
                      Yes, reset everything ({resetStep + 2}/5)
                    </Button>
                  </div>
                </>
              ) : resetStep === 5 ? (
                <>
                  <div className="mb-3">
                    <span className="block text-[12px] font-medium text-text-1 mb-1.5">
                      Type the phrase below to accept responsibility
                    </span>
                    <Input
                      autoFocus
                      placeholder={RESET_CONFIRM_PHRASE}
                      value={resetConfirm}
                      onChange={(event) => setResetConfirm(event.target.value)}
                      disabled={resetBusy}
                      className="secret uppercase text-[12px]"
                    />
                    {resetError ? (
                      <p className="mt-2 text-[12px] leading-relaxed text-critical">
                        {resetError}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Button
                      variant="secondary"
                      size="md"
                      loading={resetBusy}
                      disabled={
                        resetBusy ||
                        resetConfirm.trim().toUpperCase() !== RESET_CONFIRM_PHRASE
                      }
                      onClick={handleResetNext}
                    >
                      I understand, reset vault
                    </Button>
                    <button
                      type="button"
                      onClick={closeResetFlow}
                      className="text-[11.5px] text-text-2 hover:text-text-0"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : null}

              {resetStep === 6 && !resetBusy ? (
                <div className="mt-3 rounded-sm border border-line bg-bg-1 p-3 text-center">
                  <p className="text-[12px] text-text-0">Vault reset. Creating a new one…</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ---------- Şifre unutma tetikleyici ---------- */}
          <button
            type="button"
            onClick={openResetFlow}
            className="mt-4 flex w-full items-center justify-center gap-1.5 text-[11px] font-medium text-critical transition-colors hover:text-critical-hover disabled:opacity-40 disabled:pointer-events-none"
          >
            <Trash2 size={12} /> Forgot password? Reset vault
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

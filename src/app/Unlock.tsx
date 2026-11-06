import { motion } from 'framer-motion';
import { ArrowRight, KeyRound, LifeBuoy, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button, Input, PasswordInput } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/store/app';

export function UnlockScreen() {
  const unlock = useApp((state) => state.unlock);
  const unlockRecovery = useApp((state) => state.unlockRecovery);
  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

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
              busy || (mode === 'password' ? password.length === 0 : recoveryKey.length === 0)
            }
            className="mt-4 w-full"
          >
            {mode === 'password' ? 'Unlock' : 'Unlock with recovery key'}
            {!busy ? <ArrowRight size={15} /> : null}
          </Button>

          <button
            type="button"
            onClick={() => switchMode(mode === 'password' ? 'recovery' : 'password')}
            className="mt-4 flex w-full items-center justify-center gap-1.5 text-[12px] text-text-2 transition-colors hover:text-text-0"
          >
            {mode === 'password' ? <LifeBuoy size={13} /> : <KeyRound size={13} />}
            {mode === 'password' ? 'Use recovery key instead' : 'Use master password instead'}
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

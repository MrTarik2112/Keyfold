import { motion } from 'framer-motion';
import { Layers, Lock, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button, PasswordInput } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useApp } from '@/store/app';

export function CriticalGate() {
  const unlockCritical = useApp((state) => state.unlockCritical);
  const criticalSeconds = useApp(
    (state) => state.workspace?.settings.criticalAutoLockSeconds ?? 60,
  );
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await unlockCritical(password);
      setPassword('');
    } catch (caught) {
      setError(errorMessage(caught));
      setAttempt((value) => value + 1);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center py-10">
      <motion.div
        key={attempt}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, x: attempt > 0 ? [0, -6, 6, -4, 4, 0] : 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28, duration: 0.3 }}
        className="w-full max-w-[420px] rounded-lg border border-[color:var(--critical-border)] bg-bg-1 p-7 shadow-[var(--shadow-inset)]"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[color:var(--critical-border)] bg-critical-bg text-critical">
          <Lock size={21} />
        </div>
        <h1 className="mt-5 text-[24px] font-medium tracking-heading text-text-0">
          Critical tier is locked.
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-text-2">
          Enter the second password to reveal Critical keys. It locks again automatically after{' '}
          {criticalSeconds} seconds, independently of the rest of the vault.
        </p>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <PasswordInput
            autoFocus
            aria-label="Critical password"
            placeholder="Critical password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
          {error ? (
            <p role="alert" className="text-[12.5px] text-critical">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={busy}
            disabled={busy || password.length === 0}
          >
            Unlock Critical
          </Button>
        </form>

        <div className="mt-6 space-y-2.5 border-t border-line-subtle pt-4">
          <p className="flex gap-2 text-[11.5px] leading-relaxed text-text-2">
            <Layers size={13} className="mt-0.5 shrink-0" />
            Critical values use three encryption layers and a separate key hierarchy.
          </p>
          <p className="flex gap-2 text-[11.5px] leading-relaxed text-text-2">
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />A short delay applies after
            repeated wrong attempts.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

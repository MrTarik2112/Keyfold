import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCopy,
  Download,
  KeyRound,
  Lock,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

import { Badge, Button, Field, Input, Logo, PasswordInput } from '@/components/ui';
import { copyRecoveryKey } from '@/lib/clipboard';
import { errorMessage } from '@/lib/errors';
import { saveRecoveryKeyFile } from '@/lib/files';
import { passwordStrength } from '@/lib/password';
import { useApp } from '@/store/app';

const TOTAL_STEPS = 5;

function Rule({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[12px] leading-relaxed">
      <span
        className={
          met
            ? 'mt-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[rgba(39,166,68,0.16)] text-success'
            : 'mt-0.5 h-3.5 w-3.5 rounded-full border border-line-strong'
        }
      >
        {met ? <Check size={9} strokeWidth={3} /> : null}
      </span>
      <span className={met ? 'text-text-2' : 'text-text-2'}>{children}</span>
    </li>
  );
}

export function Onboarding() {
  const createVault = useApp((state) => state.createVault);
  const finishOnboarding = useApp((state) => state.finishOnboarding);
  const toast = useApp((state) => state.toast);

  const [step, setStep] = useState(0);
  const [master, setMaster] = useState('');
  const [masterConfirm, setMasterConfirm] = useState('');
  const [critical, setCritical] = useState('');
  const [criticalConfirm, setCriticalConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoveryConfirm, setRecoveryConfirm] = useState('');
  const [savedRecovery, setSavedRecovery] = useState(false);

  const masterStrength = useMemo(() => passwordStrength(master), [master]);
  const criticalStrength = useMemo(() => passwordStrength(critical), [critical]);

  const masterValid = master.length >= 12 && masterStrength.acceptable && master === masterConfirm;
  const criticalValid =
    critical.length >= 12 &&
    criticalStrength.acceptable &&
    critical === criticalConfirm &&
    critical !== master;

  const recoveryTail = recoveryKey
    .replace(/[^0-9A-Za-z]/g, '')
    .slice(-4)
    .toUpperCase();
  const recoveryConfirmed =
    recoveryConfirm.replace(/[^0-9A-Za-z]/g, '').toUpperCase() === recoveryTail &&
    recoveryTail.length === 4;

  function next() {
    setError(null);
    setStep((value) => Math.min(TOTAL_STEPS - 1, value + 1));
  }

  function submitMaster(event: FormEvent) {
    event.preventDefault();
    if (!masterStrength.acceptable) {
      setError('Choose a stronger password before continuing.');
      return;
    }
    if (master !== masterConfirm) {
      setError('The two passwords do not match.');
      return;
    }
    next();
  }

  async function submitCritical(event: FormEvent) {
    event.preventDefault();
    if (critical === master) {
      setError('The Critical password must be different from the master password.');
      return;
    }
    if (!criticalStrength.acceptable) {
      setError('Choose a stronger password before continuing.');
      return;
    }
    if (critical !== criticalConfirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await createVault(master, critical);
      setRecoveryKey(response.recoveryKey);
      setStep(3);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function copyRecovery() {
    try {
      const clears = await copyRecoveryKey(recoveryKey);
      toast(
        clears
          ? `Recovery key copied. Clipboard clears in ${clears}s.`
          : 'Recovery key copied. Store it somewhere safe.',
      );
    } catch (caught) {
      toast(errorMessage(caught), 'error');
    }
  }

  async function downloadRecovery() {
    try {
      const saved = await saveRecoveryKeyFile(recoveryKey);
      if (saved) {
        setSavedRecovery(true);
        toast('Recovery key saved.');
      }
    } catch (caught) {
      toast(errorMessage(caught), 'error');
    }
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-bg-0">
      <div className="relative mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-6 py-10">
        <div
          className="mb-6 flex items-center gap-2"
          aria-label={`Step ${step + 1} of ${TOTAL_STEPS}`}
        >
          {Array.from({ length: TOTAL_STEPS }, (_, index) => (
            <span
              key={index}
              className={
                index <= step
                  ? 'h-1 flex-1 rounded-full bg-accent transition-colors'
                  : 'h-1 flex-1 rounded-full bg-bg-4 transition-colors'
              }
            />
          ))}
        </div>

        <div className="rounded-lg border border-line bg-bg-1 p-7 shadow-[var(--shadow-inset)]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
            >
              {step === 0 ? (
                <div className="text-center">
                  <div className="mx-auto mb-6 inline-flex text-accent">
                    <Logo size={56} />
                  </div>
                  <h1 className="text-[32px] font-medium tracking-display text-text-0">Keyfold</h1>
                  <p className="mt-2 text-[15px] text-text-1">Every key, folded away safely.</p>
                  <p className="mx-auto mt-4 max-w-[380px] text-[13px] leading-relaxed text-text-2">
                    A private vault for the API keys that websites show you only once. Everything is
                    encrypted on this computer, and nothing ever leaves it.
                  </p>
                  <ul className="mx-auto mt-6 max-w-[330px] space-y-2.5 text-left">
                    {[
                      'Two tiers: Standard and Critical',
                      'Argon2id key derivation and modern AEAD ciphers',
                      'No accounts, no cloud, no telemetry',
                    ].map((line) => (
                      <li key={line} className="flex items-center gap-2.5 text-[13px] text-text-1">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-bg text-accent">
                          <Check size={11} strokeWidth={3} />
                        </span>
                        {line}
                      </li>
                    ))}
                  </ul>
                  <Button variant="primary" className="mt-8 w-full" onClick={next}>
                    Create your vault <ArrowRight size={15} />
                  </Button>
                </div>
              ) : null}

              {step === 1 ? (
                <form onSubmit={submitMaster} className="space-y-5">
                  <header>
                    <Badge tone="accent" icon={ShieldCheck}>
                      Standard tier
                    </Badge>
                    <h1 className="mt-3 text-[24px] font-medium tracking-heading text-text-0">
                      Create your master password
                    </h1>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-text-2">
                      This opens the vault and protects every Standard key. Use a long passphrase of
                      four or more unrelated words — it is easier to remember and harder to guess.
                    </p>
                  </header>

                  <Field label="Master password" htmlFor="master-password">
                    <PasswordInput
                      id="master-password"
                      autoFocus
                      value={master}
                      showStrength
                      onChange={(event) => setMaster(event.target.value)}
                      placeholder="At least 12 characters"
                    />
                  </Field>
                  <Field label="Confirm master password" htmlFor="master-confirm">
                    <PasswordInput
                      id="master-confirm"
                      value={masterConfirm}
                      onChange={(event) => setMasterConfirm(event.target.value)}
                      placeholder="Type it again"
                    />
                  </Field>

                  <ul className="space-y-1.5">
                    <Rule met={master.length >= 12}>At least 12 characters</Rule>
                    <Rule met={master.length > 0 && masterStrength.score >= 3}>
                      Strength score of 3 or higher
                    </Rule>
                    <Rule met={master.length > 0 && master === masterConfirm}>
                      Both entries match
                    </Rule>
                  </ul>

                  {error ? <p className="text-[12.5px] text-critical">{error}</p> : null}

                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setStep(0)} icon={ArrowLeft}>
                      Back
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      className="flex-1"
                      disabled={!masterValid}
                    >
                      Continue <ArrowRight size={15} />
                    </Button>
                  </div>
                </form>
              ) : null}

              {step === 2 ? (
                <form onSubmit={submitCritical} className="space-y-5">
                  <header>
                    <Badge tone="critical" icon={Lock}>
                      Critical tier
                    </Badge>
                    <h1 className="mt-3 text-[24px] font-medium tracking-heading text-text-0">
                      Create your Critical password
                    </h1>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-text-2">
                      This second password protects your most sensitive keys. It is required after
                      the master password, and must be different from it.
                    </p>
                  </header>

                  <Field label="Critical password" htmlFor="critical-password">
                    <PasswordInput
                      id="critical-password"
                      autoFocus
                      value={critical}
                      showStrength
                      onChange={(event) => setCritical(event.target.value)}
                      placeholder="At least 12 characters"
                    />
                  </Field>
                  <Field label="Confirm Critical password" htmlFor="critical-confirm">
                    <PasswordInput
                      id="critical-confirm"
                      value={criticalConfirm}
                      onChange={(event) => setCriticalConfirm(event.target.value)}
                      placeholder="Type it again"
                    />
                  </Field>

                  <ul className="space-y-1.5">
                    <Rule met={critical.length >= 12}>At least 12 characters</Rule>
                    <Rule met={critical.length > 0 && criticalStrength.score >= 3}>
                      Strength score of 3 or higher
                    </Rule>
                    <Rule met={critical.length > 0 && critical !== master}>
                      Different from the master password
                    </Rule>
                    <Rule met={critical.length > 0 && critical === criticalConfirm}>
                      Both entries match
                    </Rule>
                  </ul>

                  {error ? <p className="text-[12.5px] text-critical">{error}</p> : null}

                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setStep(1)} icon={ArrowLeft}>
                      Back
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      className="flex-1"
                      loading={busy}
                      disabled={!criticalValid || busy}
                    >
                      {busy ? 'Preparing your vault…' : 'Create vault'}
                      {!busy ? <ArrowRight size={15} /> : null}
                    </Button>
                  </div>
                  {busy ? (
                    <p className="text-center text-[11.5px] text-text-2">
                      Argon2id is tuned for this machine, which takes a moment.
                    </p>
                  ) : null}
                </form>
              ) : null}

              {step === 3 ? (
                <div className="space-y-5">
                  <header>
                    <Badge tone="warning" icon={KeyRound}>
                      Shown once
                    </Badge>
                    <h1 className="mt-3 text-[24px] font-medium tracking-heading text-text-0">
                      Save your recovery key
                    </h1>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-text-2">
                      This key unwraps the vault if you forget a password. It is shown only now, and
                      it is as powerful as both passwords combined.
                    </p>
                  </header>

                  <div className="rounded-sm border border-line bg-bg-0 p-4">
                    <p className="secret select-all break-all text-[13px] leading-relaxed text-text-0">
                      {recoveryKey}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      icon={ClipboardCopy}
                      className="flex-1"
                      onClick={() => void copyRecovery()}
                    >
                      Copy
                    </Button>
                    <Button
                      icon={Download}
                      className="flex-1"
                      onClick={() => void downloadRecovery()}
                    >
                      Save to file
                    </Button>
                  </div>

                  <label className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-text-1">
                    <input
                      type="checkbox"
                      checked={savedRecovery}
                      onChange={(event) => setSavedRecovery(event.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                    />
                    I saved my recovery key somewhere safe.
                  </label>

                  <Field
                    label="Confirm the last 4 characters"
                    hint="Type the four characters at the end of the key."
                  >
                    <Input
                      value={recoveryConfirm}
                      onChange={(event) => setRecoveryConfirm(event.target.value)}
                      maxLength={6}
                      autoComplete="off"
                      className="secret w-32 uppercase"
                      placeholder="••••"
                    />
                  </Field>

                  <div className="rounded-sm border border-[color:var(--critical-border)] bg-critical-bg p-3">
                    <p className="flex gap-2 text-[12px] leading-relaxed text-text-1">
                      <TriangleAlert size={14} className="mt-0.5 shrink-0 text-critical" />
                      If you lose both passwords and this recovery key, your data cannot be
                      recovered. Nobody can help, including us.
                    </p>
                  </div>

                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={!recoveryConfirmed || !savedRecovery}
                    onClick={() => {
                      setRecoveryKey('');
                      setStep(4);
                    }}
                  >
                    I have saved it <ArrowRight size={15} />
                  </Button>
                </div>
              ) : null}

              {step === 4 ? (
                <div className="space-y-5">
                  <header className="text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-bg-3 text-accent">
                      <ShieldCheck size={22} />
                    </div>
                    <h1 className="text-[24px] font-medium tracking-heading text-text-0">
                      What Keyfold protects
                    </h1>
                    <p className="mt-1.5 text-[13px] text-text-2">Honest limits, no marketing.</p>
                  </header>

                  <div className="grid gap-3">
                    <div className="rounded-sm border border-line bg-bg-2 p-3.5">
                      <p className="text-[12px] font-medium text-text-0">Protected</p>
                      <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed text-text-2">
                        <li>A copied vault file or backup leak</li>
                        <li>Offline brute-force of the master passwords</li>
                        <li>Casual shoulder-surfing and clipboard snooping</li>
                        <li>Walking away from an unlocked screen</li>
                      </ul>
                    </div>
                    <div className="rounded-sm border border-line bg-bg-2 p-3.5">
                      <p className="text-[12px] font-medium text-text-0">Not protected</p>
                      <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed text-text-2">
                        <li>Malware running while the vault is unlocked</li>
                        <li>Keyloggers</li>
                        <li>A weak or reused password</li>
                      </ul>
                    </div>
                  </div>

                  <p className="text-center text-[11.5px] leading-relaxed text-text-2">
                    Keyfold never makes a network request. Your keys are encrypted with keys derived
                    on this machine and stored in one file under your user profile.
                  </p>

                  <Button variant="primary" className="w-full" onClick={finishOnboarding}>
                    Enter Keyfold <ArrowRight size={15} />
                  </Button>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

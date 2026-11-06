import { MotionConfig, motion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { useEffect } from 'react';

import { TitleBar } from '@/components/TitleBar';
import { Button, Toasts, TooltipProvider } from '@/components/ui';
import { onCriticalLocked, onLocked } from '@/lib/ipc';
import { useApp } from '@/store/app';
import { Onboarding } from './Onboarding';
import { UnlockScreen } from './Unlock';
import { Workspace } from './Workspace';

export function App() {
  const booted = useApp((state) => state.booted);
  const bootError = useApp((state) => state.bootError);
  const route = useApp((state) => state.route);
  const settings = useApp((state) => state.settings);
  const init = useApp((state) => state.init);
  const refreshSession = useApp((state) => state.refreshSession);
  const refresh = useApp((state) => state.refresh);
  const hideSecrets = useApp((state) => state.hideSecrets);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const hide = () => hideSecrets();
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') hideSecrets();
    };
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [hideSecrets]);

  useEffect(() => {
    if (!settings) return;
    document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion);
    document.documentElement.classList.toggle('compact', settings.compactMode);
  }, [settings]);

  useEffect(() => {
    let stopLocked: (() => void) | undefined;
    let stopCritical: (() => void) | undefined;
    void onLocked(() => {
      void refreshSession();
    }).then((stop) => {
      stopLocked = stop;
    });
    void onCriticalLocked(() => {
      void refreshSession().then(() => refresh());
    }).then((stop) => {
      stopCritical = stop;
    });
    return () => {
      stopLocked?.();
      stopCritical?.();
    };
  }, [refresh, refreshSession]);

  let screen = <UnlockScreen />;
  if (route === 'onboarding') screen = <Onboarding />;
  if (route === 'workspace') screen = <Workspace />;

  return (
    <MotionConfig reducedMotion={settings?.reduceMotion ? 'always' : 'user'}>
      <TooltipProvider>
        <div className="flex h-full flex-col overflow-hidden bg-bg-0 text-text-0">
          <TitleBar compact={route !== 'workspace'} />
          {bootError ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="max-w-[380px] rounded-lg border border-line bg-bg-1 p-6 text-center shadow-[var(--shadow-inset)]">
                <ShieldAlert size={22} className="mx-auto text-critical" />
                <h1 className="mt-3 text-[18px] font-medium tracking-heading text-text-0">
                  Keyfold cannot start
                </h1>
                <p className="mt-2 text-[13px] leading-relaxed text-text-2">{bootError}</p>
                <Button variant="primary" className="mt-4" onClick={() => void init()}>
                  Try again
                </Button>
              </div>
            </div>
          ) : !booted ? (
            <div className="flex flex-1 items-center justify-center">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center gap-3 text-text-2"
              >
                <span className="text-[12px] tracking-wide">Opening Keyfold…</span>
              </motion.div>
            </div>
          ) : (
            screen
          )}
          <Toasts />
        </div>
      </TooltipProvider>
    </MotionConfig>
  );
}

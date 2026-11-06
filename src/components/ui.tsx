import * as Dialog from '@radix-ui/react-dialog';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  forwardRef,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '@/lib/cn';
import { passwordStrength } from '@/lib/password';
import { useApp } from '@/store/app';

/* ---------------------------------- logo --------------------------------- */

export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      className={className}
      role="img"
      aria-label="Keyfold"
    >
      <rect width="1024" height="1024" rx="224" fill="#08090a" />
      <path
        d="M352 208h248l88 88v160c0 26-21 48-48 48H352c-27 0-48-22-48-48V256c0-27 21-48 48-48z"
        fill="currentColor"
      />
      <path d="M600 208l88 88h-88z" fill="currentColor" opacity="0.55" />
      <circle cx="500" cy="352" r="66" fill="#08090a" />
      <rect x="462" y="440" width="88" height="376" rx="44" fill="currentColor" />
      <rect x="550" y="636" width="104" height="48" rx="24" fill="currentColor" />
      <rect x="550" y="724" width="72" height="48" rx="24" fill="currentColor" />
    </svg>
  );
}

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex text-accent">
      <Logo size={size} />
    </span>
  );
}

/* --------------------------------- buttons -------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-[#08090a] hover:bg-accent-hover border border-transparent font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]',
  secondary:
    'bg-transparent text-text-1 border border-line hover:bg-bg-3 hover:border-line-strong hover:text-text-0',
  ghost: 'bg-transparent text-text-2 border border-transparent hover:bg-bg-3 hover:text-text-0',
  danger: 'bg-critical text-[#08090a] border border-transparent hover:brightness-110 font-medium',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12.5px] gap-1.5 rounded-sm',
  md: 'h-9 px-4 text-[13.5px] gap-2 rounded-sm',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon size={15} aria-hidden />
      ) : null}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: number;
  tone?: 'default' | 'danger';
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 15, tone = 'default', active, className, ...props },
  ref,
) {
  return (
    <Tooltip content={label}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-sm border border-transparent text-text-2 transition-colors hover:bg-bg-3 hover:text-text-0 disabled:opacity-40',
          tone === 'danger' && 'hover:bg-critical-bg hover:text-critical',
          active && 'bg-accent-bg text-accent',
          className,
        )}
        {...props}
      >
        <Icon size={size} aria-hidden />
      </button>
    </Tooltip>
  );
});

/* --------------------------------- inputs --------------------------------- */

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-sm border bg-[rgba(255,255,255,0.02)] px-3.5 text-[13.5px] text-text-1 outline-none transition-colors placeholder:text-text-2',
        invalid ? 'border-critical' : 'border-[rgba(255,255,255,0.08)] focus:border-text-1',
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'min-h-[72px] w-full resize-y rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3.5 py-2.5 text-[13.5px] text-text-1 outline-none transition-colors placeholder:text-text-2 focus:border-text-1',
        className,
      )}
      {...props}
    />
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[12px] font-medium tracking-ui text-text-1">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] text-critical">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-text-2">{hint}</p>
      ) : null}
    </div>
  );
}

export function StrengthMeter({ password }: { password: string }) {
  const strength = passwordStrength(password);
  const colors = [
    'var(--critical)',
    'var(--critical)',
    'var(--warning)',
    'var(--success)',
    'var(--success)',
  ];
  return (
    <div className="space-y-1.5" aria-live="polite">
      <div
        className="flex gap-1"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={strength.score}
        aria-label="Password strength"
      >
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{
              background:
                password && index < Math.max(1, strength.score)
                  ? colors[strength.score]
                  : 'var(--bg-4)',
            }}
          />
        ))}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11.5px] text-text-2">
          {password ? strength.label : 'At least 12 characters'}
        </span>
        {strength.warning ? (
          <span className="text-right text-[11.5px] text-warning">{strength.warning}</span>
        ) : null}
      </div>
    </div>
  );
}

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  showStrength?: boolean;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, showStrength, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    const id = useId();
    return (
      <div className="space-y-2">
        <div className="relative">
          <input
            ref={ref}
            id={id}
            type={visible ? 'text' : 'password'}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className={cn(
              'h-10 w-full rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] pl-3.5 pr-11 secret text-text-1 outline-none transition-colors placeholder:font-sans placeholder:text-text-2 focus:border-text-1',
              className,
            )}
            {...props}
          />
          <button
            type="button"
            aria-label={visible ? 'Hide password' : 'Show password'}
            onClick={() => setVisible((value) => !value)}
            className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-sm text-text-2 hover:bg-bg-3 hover:text-text-0"
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {showStrength ? <StrengthMeter password={String(props.value ?? '')} /> : null}
      </div>
    );
  },
);

/* --------------------------------- switch --------------------------------- */

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors',
        checked ? 'border-accent bg-accent' : 'border-line bg-bg-4',
        disabled && 'opacity-40',
      )}
    >
      <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-[3px] rounded-full bg-text-1 transition-transform data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-[#08090a]" />
    </SwitchPrimitive.Root>
  );
}

/* --------------------------------- select --------------------------------- */

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root
      value={String(value)}
      onValueChange={(next) => {
        const match = options.find((option) => String(option.value) === next);
        if (match) onChange(match.value);
      }}
    >
      <SelectPrimitive.Trigger
        aria-label={label}
        className={cn(
          'inline-flex h-9 w-full items-center justify-between gap-2 rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 text-[13.5px] text-text-1 outline-none hover:border-line-strong focus:border-text-1',
          className,
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown size={14} className="text-text-2" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-[60] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-sm border border-line bg-bg-1 p-1 shadow-sm"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={String(option.value)}
                value={String(option.value)}
                className="relative flex h-8 cursor-default select-none items-center rounded-xs px-2 pr-7 text-[13px] text-text-1 outline-none data-[highlighted]:bg-bg-3 data-[highlighted]:text-text-0"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <Check size={14} className="text-accent" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/* -------------------------------- tooltip --------------------------------- */

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={450} skipDelayDuration={150}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[70] rounded-sm border border-line bg-bg-2 px-2 py-1 text-[11.5px] text-text-1 shadow-sm"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-bg-2" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ---------------------------------- misc ---------------------------------- */

export function Badge({
  children,
  tone = 'neutral',
  icon: Icon,
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'critical' | 'warning' | 'success';
  icon?: LucideIcon;
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-transparent text-text-2 bg-[rgba(255,255,255,0.05)]',
    accent: 'border-[color:var(--accent-border)] text-accent bg-accent-bg',
    critical: 'border-[color:var(--critical-border)] text-critical bg-critical-bg',
    warning: 'border-[color:var(--warning-border)] text-warning bg-accent-bg',
    success: 'border-[color:var(--success-border)] text-success bg-[rgba(39,166,68,0.12)]',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      {Icon ? <Icon size={11} aria-hidden /> : null}
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line bg-bg-3 px-1.5 font-mono text-[10.5px] text-text-2">
      {children}
    </kbd>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-text-2" aria-label="Loading" />;
}

export function EmptyState({
  icon: Icon = ShieldCheck,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-8 py-14 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-bg-1 text-text-2">
        <Icon size={19} />
      </div>
      <h3 className="text-[15px] font-medium text-text-0">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-text-2">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'md',
  tone = 'default',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'critical';
}) {
  const widths = { sm: 'max-w-[400px]', md: 'max-w-[480px]', lg: 'max-w-[600px]' };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]"
          />
        </Dialog.Overlay>
        <Dialog.Content asChild>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-5"
            onClick={(event) => {
              if (event.target === event.currentTarget) onOpenChange(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.975 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className={cn(
                'relative flex max-h-[calc(100vh_-_40px)] w-full flex-col overflow-hidden rounded-lg border bg-bg-1 shadow-[var(--shadow-inset)]',
                tone === 'critical' ? 'border-[color:var(--critical-border)]' : 'border-line',
                widths[width],
              )}
            >
              <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-6">
                <div>
                  <Dialog.Title className="text-[18px] font-medium tracking-heading text-text-0">
                    {title}
                  </Dialog.Title>
                  {description ? (
                    <Dialog.Description className="mt-1 text-[13px] leading-relaxed text-text-2">
                      {description}
                    </Dialog.Description>
                  ) : null}
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label="Close"
                    className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-text-2 hover:bg-bg-3 hover:text-text-0"
                  >
                    <X size={16} />
                  </button>
                </Dialog.Close>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>
              {footer ? (
                <div className="flex shrink-0 justify-end gap-2 border-t border-line-subtle bg-bg-1 px-6 py-4">
                  {footer}
                </div>
              ) : null}
            </motion.div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* --------------------------------- toasts --------------------------------- */

export function Toasts() {
  const toasts = useApp((state) => state.toasts);
  const dismiss = useApp((state) => state.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[80] flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={cn(
              'pointer-events-auto flex w-full items-center gap-3 rounded-sm border bg-bg-1 px-3.5 py-2.5 text-[12.5px] text-text-1 shadow-sm',
              toast.tone === 'error' && 'border-[color:var(--critical-border)]',
              toast.tone === 'success' && 'border-line',
              toast.tone === 'info' && 'border-line',
            )}
            role="status"
          >
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                toast.tone === 'error'
                  ? 'bg-critical'
                  : toast.tone === 'info'
                    ? 'bg-text-3'
                    : 'bg-success',
              )}
            />
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
              className="text-text-2 hover:text-text-1"
            >
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

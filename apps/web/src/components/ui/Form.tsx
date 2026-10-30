import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const control =
  'block w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 shadow-sm transition focus:border-turtle-500 focus:outline-none focus:ring-2 focus:ring-turtle-500/25 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50';

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: (id: string) => ReactNode;
}

/** Label + control + hint/error, with ids wired for accessibility. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-ink-700 dark:text-ink-200">
          {label}
          {required && <span className="ms-0.5 text-red-500">*</span>}
        </label>
      )}
      {children(id)}
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : hint ? <p className="text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, leading, trailing, invalid, ...rest }, ref) {
  if (!leading && !trailing) return <input ref={ref} className={cn(control, 'h-10', invalid && 'border-red-400 focus:ring-red-500/25', className)} {...rest} />;
  return (
    <div className={cn('relative flex items-center', className)}>
      {leading && <span className="pointer-events-none absolute start-3 text-ink-400">{leading}</span>}
      <input ref={ref} className={cn(control, 'h-10', leading && 'ps-9', trailing && 'pe-10', invalid && 'border-red-400')} {...rest} />
      {trailing && <span className="absolute end-3 text-ink-400">{trailing}</span>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-[84px] py-2', className)} {...rest} />;
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, options, placeholder, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(control, 'h-10 pe-8', className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
});

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm text-ink-700 dark:text-ink-200', className)}>
      <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-turtle-600 focus:ring-turtle-500" {...rest} />
      {label}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-3', disabled && 'cursor-not-allowed opacity-60')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-turtle-600' : 'bg-ink-300 dark:bg-ink-600')}
      >
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'start-[22px]' : 'start-0.5')} />
      </button>
      {label && <span className="text-sm text-ink-700 dark:text-ink-200">{label}</span>}
    </label>
  );
}

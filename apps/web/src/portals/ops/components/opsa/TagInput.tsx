import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Chip editor for keyword lists: Enter or comma adds, Backspace removes the last chip. */
export function TagInput({ id, value, onChange, placeholder, max = 200, className }: { id?: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number; className?: string }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase()) && next.length < max) next.push(p.slice(0, 100));
    onChange(next);
    setText('');
  };
  return (
    <div className={cn('flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2 py-1.5 focus-within:border-turtle-500 focus-within:ring-2 focus-within:ring-turtle-500/25 dark:border-ink-700 dark:bg-ink-900', className)}>
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700 dark:bg-ink-800 dark:text-ink-200">
          {tag}
          <button type="button" aria-label={`remove ${tag}`} onClick={() => onChange(value.filter((x) => x !== tag))} className="text-ink-400 hover:text-red-600">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,،]$/.test(v)) add(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
        placeholder={value.length ? '' : placeholder}
        className="min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-ink-50"
      />
    </div>
  );
}

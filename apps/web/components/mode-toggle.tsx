'use client';

import { Code, MessageCircleQuestion } from 'lucide-react';
import type { RunMode } from '@/lib/types';

const MODES: { mode: RunMode; label: string; title: string; Icon: typeof Code }[] = [
  { mode: 'code', label: 'Code', title: 'Code: weft can edit files and run commands', Icon: Code },
  {
    mode: 'ask',
    label: 'Ask',
    title: "Ask: read-only, weft answers from the code and won't change files",
    Icon: MessageCircleQuestion,
  },
];

export function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: RunMode;
  onChange: (mode: RunMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Mode"
      className="flex shrink-0 rounded-lg bg-surface-2 p-0.5"
    >
      <input type="hidden" name="mode" value={mode} />
      {MODES.map(({ mode: m, label, title, Icon }) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          title={title}
          disabled={disabled}
          onClick={() => onChange(m)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition disabled:opacity-60 ${
            mode === m ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'
          }`}
        >
          <Icon className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

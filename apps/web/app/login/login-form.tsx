'use client';

import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useActionState } from 'react';
import { LogoMark } from '@/components/logo';
import { loginAction } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, {});

  return (
    <form action={action} className="grid w-full max-w-xs gap-4">
      <div className="grid justify-items-center gap-3 text-center">
        <LogoMark className="size-10" />
        <h1 className="text-xl font-semibold tracking-tight">Sign in to weft</h1>
      </div>
      <input
        type="password"
        name="password"
        placeholder="Password"
        autoComplete="current-password"
        autoFocus
        required
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none transition placeholder:text-faint focus:border-accent/50 focus:ring-4 focus:ring-accent-soft"
      />
      <button
        disabled={pending}
        className="flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <ArrowRight className="size-4" />
        )}
        Sign in
      </button>
      {state.error && <p className="text-center text-xs text-bad">{state.error}</p>}
    </form>
  );
}

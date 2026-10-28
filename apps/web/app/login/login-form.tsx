'use client';

import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useActionState } from 'react';
import { LogoMark } from '@/components/logo';
import { loginAction } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, {});

  return (
    <div className="landing-rise relative w-full max-w-sm">
      <div className="pointer-events-none absolute -inset-px rounded-[25px] bg-gradient-to-b from-accent/35 via-line-strong to-line" />
      <form
        action={action}
        className="relative grid gap-5 rounded-3xl bg-surface/90 p-8 shadow-card backdrop-blur-xl"
      >
        <div className="grid justify-items-center gap-3 text-center">
          <LogoMark className="size-10" gap="var(--surface)" />
          <h1 className="text-2xl font-semibold tracking-[-0.035em]">Welcome back</h1>
          <p className="text-sm text-muted">Sign in to pick up where you left off.</p>
        </div>
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoComplete="current-password"
          autoFocus
          required
          className="w-full rounded-full border border-line-strong bg-bg/60 px-4 py-2.5 text-sm outline-none transition placeholder:text-faint focus:border-accent/50 focus:ring-4 focus:ring-accent-soft"
        />
        <button
          disabled={pending}
          className="group flex items-center justify-center gap-2 rounded-full bg-fg px-4 py-2.5 text-sm font-medium text-bg transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <>
              Sign in
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </>
          )}
        </button>
        {state.error && (
          <p className="rounded-xl border border-bad/20 bg-bad-soft px-3 py-2 text-center text-xs text-bad">
            {state.error}
          </p>
        )}
      </form>
    </div>
  );
}

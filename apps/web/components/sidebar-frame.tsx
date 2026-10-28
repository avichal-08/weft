'use client';

import { LogOut, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { logoutAction } from '@/app/login/actions';
import { Logo, LogoMark } from './logo';

const KEY = 'weft.sidebar';
const EVENT = 'weft-sidebar';

const iconButton =
  'grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function toggle() {
  try {
    localStorage.setItem(KEY, readCollapsed() ? 'open' : 'collapsed');
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function SidebarFrame({ list, account }: { list: ReactNode; account: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (collapsed) {
    return (
      <aside className="hidden w-14 shrink-0 flex-col items-center gap-2 border-r border-line bg-surface py-4 md:flex">
        <Link href="/chat" aria-label="weft" className="mb-2">
          <LogoMark gap="var(--surface)" />
        </Link>
        <button
          type="button"
          onClick={toggle}
          className={iconButton}
          title="Expand sidebar (Ctrl+B)"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen className="size-4" />
        </button>
        <Link href="/chat" className={iconButton} title="New chat" aria-label="New chat">
          <Plus className="size-4" />
        </Link>
        <form action={logoutAction} className="mt-auto">
          <button className={iconButton} title="Sign out" aria-label="Sign out">
            <LogOut className="size-4" />
          </button>
        </form>
      </aside>
    );
  }

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex items-center justify-between px-4 pt-4 pb-4">
        <Link href="/chat" aria-label="weft">
          <Logo gap="var(--surface)" />
        </Link>
        <button
          type="button"
          onClick={toggle}
          className={iconButton}
          title="Collapse sidebar (Ctrl+B)"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>
      <div className="px-3 pb-5">
        <Link
          href="/chat"
          className="flex items-center justify-center gap-1.5 rounded-full bg-fg px-3 py-2 text-[13px] font-medium text-bg transition hover:opacity-90"
        >
          <Plus className="size-4" strokeWidth={2.25} /> New chat
        </Link>
      </div>
      <nav className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-4">
        {list}
      </nav>
      {account}
    </aside>
  );
}

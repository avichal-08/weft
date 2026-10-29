'use client';

import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, SquarePen, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
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

function Panel({
  list,
  account,
  corner,
}: {
  list: ReactNode;
  account: ReactNode;
  corner: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-4 pt-4 pb-4">
        <Link href="/chat" aria-label="weft">
          <Logo gap="var(--surface)" />
        </Link>
        {corner}
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
    </>
  );
}

export function SidebarFrame({ list, account }: { list: ReactNode; account: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface/80 px-3 py-2.5 backdrop-blur-xl md:hidden">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className={iconButton}
          aria-label="Open sidebar"
          aria-expanded={drawer}
        >
          <Menu className="size-[18px]" />
        </button>
        <Link href="/chat" aria-label="weft" className="mr-auto">
          <Logo gap="var(--surface)" />
        </Link>
        <Link href="/chat" className={iconButton} aria-label="New chat" title="New chat">
          <SquarePen className="size-[18px]" />
        </Link>
      </header>

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal aria-label="Sidebar">
          <button
            type="button"
            aria-label="Close sidebar"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          />
          <aside
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a')) setDrawer(false);
            }}
            className="drawer-in absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col border-r border-line bg-surface shadow-card"
          >
            <Panel
              list={list}
              account={account}
              corner={
                <button
                  type="button"
                  onClick={() => setDrawer(false)}
                  className={iconButton}
                  aria-label="Close sidebar"
                >
                  <X className="size-4" />
                </button>
              }
            />
          </aside>
        </div>
      )}

      {collapsed ? (
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
      ) : (
        <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
          <Panel
            list={list}
            account={account}
            corner={
              <button
                type="button"
                onClick={toggle}
                className={iconButton}
                title="Collapse sidebar (Ctrl+B)"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="size-4" />
              </button>
            }
          />
        </aside>
      )}
    </>
  );
}

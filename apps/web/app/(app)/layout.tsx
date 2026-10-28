import Link from 'next/link';
import { Logo } from '@/components/logo';
import { Sidebar } from '@/components/sidebar';

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
          <Link href="/chat">
            <Logo />
          </Link>
          <Link href="/chat" className="text-sm text-muted">
            New chat
          </Link>
        </header>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </>
  );
}

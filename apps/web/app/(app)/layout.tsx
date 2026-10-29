import { Sidebar } from '@/components/sidebar';

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col md:flex-row">
      <Sidebar />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

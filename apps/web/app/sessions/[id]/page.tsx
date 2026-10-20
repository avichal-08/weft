import { Suspense } from 'react';
import { ChatView } from '@/components/chat-view';

export default function SessionPage({ params }: PageProps<'/sessions/[id]'>) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-zinc-500">Loading chat…</p>}>
      <ChatView params={params} />
    </Suspense>
  );
}

import { Suspense } from 'react';
import { ChatView } from '@/components/chat-view';
import { ChatSkeleton } from '@/components/skeletons';

export default function SessionPage({ params }: PageProps<'/sessions/[id]'>) {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatView params={params} />
    </Suspense>
  );
}

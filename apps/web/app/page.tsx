import { NewChatForm } from '@/components/new-chat-form';

export default function Home() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-2xl grid-cols-1 gap-6 px-6 py-16">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">What should weft work on?</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Point it at a repository, then ask a question or describe a change. It works in an
            isolated sandbox, shows each step, and keeps the conversation going.
          </p>
        </div>
        <NewChatForm />
      </div>
    </div>
  );
}

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Prose({ children, muted = false }: { children: string; muted?: boolean }) {
  return (
    <div
      className={`prose prose-zinc dark:prose-invert max-w-none text-[15px] leading-7 prose-p:my-3 prose-pre:rounded-lg prose-pre:bg-zinc-950 prose-pre:text-[13px] prose-pre:text-zinc-100 prose-code:rounded prose-code:bg-zinc-100 prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none dark:prose-code:bg-zinc-800 [&_pre_code]:bg-transparent [&_pre_code]:p-0 ${muted ? 'text-sm text-zinc-500 dark:text-zinc-400' : ''}`}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

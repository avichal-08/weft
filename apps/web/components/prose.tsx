import { Children, isValidElement, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './code-block';

const components: Components = {
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => (
    <h3 className="mt-6 mb-2 text-lg font-semibold tracking-tight">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-6 mb-2 text-base font-semibold tracking-tight">{children}</h3>
  ),
  h3: ({ children }) => <h4 className="mt-5 mb-2 font-semibold">{children}</h4>,
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1.5 pl-5 marker:text-faint">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1.5 pl-5 marker:text-faint">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent underline-offset-2 hover:underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-line-strong pl-4 text-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-line" />,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line bg-surface-2 px-3 py-2 font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-line px-3 py-2 last:border-0">{children}</td>
  ),
  code: ({ children }) => (
    <code className="rounded-[5px] bg-surface-2 px-[5px] py-px font-mono text-[0.84em] text-fg">
      {children}
    </code>
  ),
  pre: ({ children }) => {
    const child = Children.toArray(children)[0];
    if (!isValidElement<{ className?: string; children?: ReactNode }>(child))
      return <pre>{children}</pre>;
    const lang = /language-([\w-]+)/.exec(child.props.className ?? '')?.[1];
    const code = String(child.props.children ?? '').replace(/\n$/, '');
    return <CodeBlock code={code} lang={lang} />;
  },
};

export function Prose({ children, size = 'base' }: { children: string; size?: 'base' | 'sm' }) {
  return (
    <div
      className={`min-w-0 break-words ${size === 'sm' ? 'text-sm leading-6 text-muted' : 'text-[15px] leading-7'}`}
    >
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {children}
      </Markdown>
    </div>
  );
}

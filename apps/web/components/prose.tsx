import { Children, isValidElement, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { CodeBlock } from './code-block';
import { baseComponents, MarkdownText } from './markdown';

const components: Components = {
  ...baseComponents,
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
    <MarkdownText size={size} components={components}>
      {children}
    </MarkdownText>
  );
}

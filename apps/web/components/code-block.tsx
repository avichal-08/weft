import { bundledLanguages, codeToHtml, type BundledLanguage } from 'shiki';
import { CopyButton } from './copy-button';

const isLanguage = (lang: string): lang is BundledLanguage => Object.hasOwn(bundledLanguages, lang);

export async function CodeBlock({ code, lang }: { code: string; lang?: string | undefined }) {
  const language = lang && isLanguage(lang) ? lang : 'text';
  const html = await codeToHtml(code, {
    lang: language,
    themes: { light: 'github-light', dark: 'github-dark-default' },
    defaultColor: false,
  });

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-line bg-code">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="font-mono text-[11px] tracking-wide text-faint uppercase">
          {lang || 'text'}
        </span>
        <CopyButton text={code} />
      </div>
      <div
        className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-6 [&_pre]:!bg-transparent"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

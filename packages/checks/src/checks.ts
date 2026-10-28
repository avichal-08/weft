import { parseDiff, type FileDiff } from './diff.ts';
import { rewrittenLines } from './rewrites.ts';

export type FindingKind = 'secret' | 'workflow' | 'test_rewrite' | 'large_file';

export type Finding = {
  kind: FindingKind;
  severity: 'block' | 'warn';
  file: string;
  line?: number;
  message: string;
};

export const LARGE_FILE_BYTES = 1_000_000;

const SECRETS: { name: string; pattern: RegExp }[] = [
  { name: 'an AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    name: 'a GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,})\b/,
  },
  { name: 'a private key', pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { name: 'a Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'a Stripe live key', pattern: /\b[rs]k_live_[A-Za-z0-9]{16,}/ },
  { name: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'an Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'an OpenAI API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/ },
];

const ENV_FILE = /(?:^|\/)\.env(?:\.[^/]+)?$/;
const ENV_TEMPLATE = /\.(?:example|sample|template|dist)$/;
const WORKFLOW = /^\.github\/workflows\//;
const TEST_FILE = /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

function secrets(f: FileDiff): Finding[] {
  if (f.deleted) return [];
  if (ENV_FILE.test(f.path) && !ENV_TEMPLATE.test(f.path)) {
    return [
      {
        kind: 'secret',
        severity: 'block',
        file: f.path,
        message: `${f.path} is an environment file, which usually holds secrets; ask weft to remove it from the change`,
      },
    ];
  }
  const found: Finding[] = [];
  for (const { line, text } of f.addedLines) {
    const hit = SECRETS.find((s) => s.pattern.test(text));
    if (hit) {
      found.push({
        kind: 'secret',
        severity: 'block',
        file: f.path,
        line,
        message: `${f.path}:${line} looks like ${hit.name}; ask weft to remove it`,
      });
    }
  }
  return found;
}

function workflow(f: FileDiff): Finding[] {
  if (!WORKFLOW.test(f.path)) return [];
  return [
    {
      kind: 'workflow',
      severity: 'block',
      file: f.path,
      message: `${f.path} is a GitHub Actions workflow, which weft's GitHub App isn't allowed to push; ask weft to leave it unchanged`,
    },
  ];
}

function testRewrite(f: FileDiff): Finding[] {
  if (f.added || !TEST_FILE.test(f.path)) return [];
  const n = rewrittenLines(
    f.removedLines,
    f.addedLines.map((l) => l.text),
  );
  if (n === 0) return [];
  return [
    {
      kind: 'test_rewrite',
      severity: 'warn',
      file: f.path,
      message: `${f.path}: ${n} existing test ${n === 1 ? 'line was' : 'lines were'} changed or removed; check the tests still test what they did`,
    },
  ];
}

function largeFile(f: FileDiff): Finding[] {
  if (f.deleted || f.bytes <= LARGE_FILE_BYTES) return [];
  return [
    {
      kind: 'large_file',
      severity: 'warn',
      file: f.path,
      message: `${f.path} adds ${(f.bytes / 1e6).toFixed(1)} MB`,
    },
  ];
}

export function checkDiff(diff: string): Finding[] {
  return parseDiff(diff).flatMap((f) => [
    ...secrets(f),
    ...workflow(f),
    ...testRewrite(f),
    ...largeFile(f),
  ]);
}

export const blocking = (findings: readonly Finding[]) =>
  findings.filter((f) => f.severity === 'block');

# @weft/checks

Checks on a chat's diff before it can be committed or published: secrets, workflow files the
GitHub App can't push, rewritten tests and large files. Pure functions over a `git diff --binary`,
no dependencies. Why these checks and not a scanner:
[ADR 0009](../../docs/decisions/0009-diff-checks.md).

```ts
import { blocking, checkDiff } from '@weft/checks';

const findings = checkDiff(diff);
// [{ kind: 'secret', severity: 'block', file: 'src/config.js', line: 12,
//    message: 'src/config.js:12 looks like a GitHub token; ask weft to remove it' }]
if (blocking(findings).length) {
  // refuse the commit, with the messages as the reason
}
```

## Checks

| Kind           | Severity | Finds                                                                                                                                                                                                                                                                     |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secret`       | block    | Added lines matching high-confidence token formats (AWS access keys, GitHub tokens, private key headers, Slack, Stripe live, Google, Anthropic and OpenAI keys), and any added or changed `.env` file except templates (`.env.example`, `.sample`, `.template`, `.dist`). |
| `workflow`     | block    | Any change under `.github/workflows/`: the app has no `workflows` permission, so GitHub would refuse the push.                                                                                                                                                            |
| `test_rewrite` | warn     | Lines removed from an existing test file (`test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`) that no added line keeps, word for word in order.                                                                                                                      |
| `large_file`   | warn     | A file whose added content is over 1 MB (`LARGE_FILE_BYTES`), binary sizes taken from the patch.                                                                                                                                                                          |

- **Messages never repeat a secret**, only the file, line and what it looks like.
- **Only added lines are scanned**, so a secret the agent removed, or one already in the repository
  and left alone, isn't reported.
- **`rewrittenTestLines(diff)`** counts rewritten lines across a whole diff; the agent eval uses it
  to measure test tampering, so the product and the eval share one rule.
- `parseDiff(diff)` is exported for anything else that needs files, line numbers and binary sizes
  from a diff.

## Testing

```bash
pnpm --filter @weft/checks test
```

The tests build their fake tokens at runtime, so no token-shaped string is ever committed (GitHub
push protection would refuse it).

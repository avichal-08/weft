# @weft/tsconfig

Shared TypeScript settings for every package.

```json
{ "extends": "@weft/tsconfig/node.json", "include": ["src", "test"] }
```

| File        | For                                      |
| ----------- | ---------------------------------------- |
| `base.json` | Everything: strict mode and module rules |
| `node.json` | Node packages: adds Node types           |

Notable choices:

- **Strict plus extras:** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- **`noEmit`:** `tsc` only type-checks. Code runs through Node's type stripping, vitest or a
  bundler, never compiled `tsc` output.
- **`.ts` imports:** `allowImportingTsExtensions`, so imports name the real file.
- **`erasableSyntaxOnly`:** bans `enum`, `namespace` and constructor parameter properties, so
  every file can run directly on Node with no build step.

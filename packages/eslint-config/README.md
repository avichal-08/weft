# @weft/eslint-config

Shared ESLint flat config for TypeScript packages: `typescript-eslint` with type-aware rules.

```js
// eslint.config.js
import config from '@weft/eslint-config';

export default config;
```

Beyond the recommended sets it enforces:

- `no-floating-promises` and `no-misused-promises`: an un-awaited promise in a worker is a
  silent bug.
- `consistent-type-imports`: type-only imports are marked, so they're erased at runtime.
- Unused variables and arguments are errors, unless prefixed with `_`.

`apps/web` uses Next's own config instead.

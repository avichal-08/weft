# 0011. Single-user sign-in with a password and a signed cookie

- Status: Accepted
- Date: 2026-10-28

## Context

weft is being deployed on a public URL for one user. Without sign-in, anyone who finds it could
start turns on the owner's LLM keys, run code in the worker's sandboxes and push to the
owner's repositories through the GitHub App. The API has no authentication of its own; it is
reachable only from the web app's server, so the web app is the one place to guard.

## Decision

- **One password, no username and no user table.** The password is stored as a scrypt hash in
  `WEFT_PASSWORD_HASH`, generated with `pnpm --filter @weft/web auth:hash`. The hash format uses
  `:` separators so it can sit unquoted in a `.env` file or Docker Compose environment.
- **A stateless session cookie:** an HS256 JWT signed with `SESSION_SECRET` (at least 32
  characters), subject `owner`, valid 7 days, `HttpOnly`, `SameSite=Lax`, `Secure` in
  production. Verification pins the algorithm and subject.
- **Checked twice.** `proxy.ts` guards every request except `/login` and static assets: pages
  redirect to `/login`, `/api/*` answers 401. Each Server Action and the stream route check the
  session again, because a matcher or a moved route can silently drop the proxy's coverage.
- **Login is rate-limited**, five attempts a minute per client IP, in memory.
- **Fail closed:** without both variables nobody can sign in.

## Alternatives considered

**An identity provider** (Entra ID or GitHub through the platform's built-in auth, or OAuth in
the app). No password to manage and MFA for free, but it ties weft to a platform feature or adds
an OAuth app and callback handling; for one user a strong password is enough for now.

**Encrypted sessions** (iron-session). The session carries no data worth hiding, so a signature is
enough.

**Sessions in the database.** Revocable one at a time, but adds a table and a query to every
request; with one user, rotating `SESSION_SECRET` signs out everything.

**Basic auth at the reverse proxy.** Simplest, but the browser's prompt can't sign out, gives no
rate limiting and sends the password with every request.

## Consequences

- Only someone with the password reaches any page, action or stream.
- No per-session revocation; rotating the secret is the way to sign out everywhere.
- The rate limit is per process and resets on restart; it slows guessing, and the scrypt cost and
  a long password do the rest.
- The client IP comes from `X-Forwarded-For`, which is only trustworthy behind the reverse proxy
  that sets it; the deployment must not expose the web app directly.
- Adding users later means a user table and a login with a username; the session format can stay.

# infra/deploy

Production stack for one VM ([ADR 0012](../../docs/decisions/0012-single-vm-deployment.md)), on AWS
EC2 ([ADR 0013](../../docs/decisions/0013-hosting-on-aws-ec2.md)):
Caddy in front, web, api, worker and Redis behind it, Postgres on Neon.

| Service   | Image                              | Exposed    | Gets                                                       |
| --------- | ---------------------------------- | ---------- | ---------------------------------------------------------- |
| `caddy`   | `caddy:2.10-alpine`                | 80, 443    | `WEFT_DOMAIN`; certificates in the `caddy-data` volume     |
| `web`     | `${WEFT_IMAGE}-web:${WEFT_TAG}`    | no         | `API_URL`, `WEFT_PASSWORD_HASH`, `SESSION_SECRET`          |
| `api`     | `${WEFT_IMAGE}-api:${WEFT_TAG}`    | no         | `DATABASE_URL`, LLM settings and keys                      |
| `worker`  | `${WEFT_IMAGE}-worker:${WEFT_TAG}` | no         | the above, sandbox settings, Docker socket, GitHub App key |
| `redis`   | `redis:7.4-alpine`                 | no         | append-only file in the `redis-data` volume                |
| `sandbox` | `${SANDBOX_IMAGE}`                 | never runs | listed so `docker compose --profile image pull` fetches it |

- `Caddyfile`: TLS for `WEFT_DOMAIN`, HSTS and other security headers, compression, and
  `flush_interval -1` so the live stream isn't buffered. Caddy sets `X-Forwarded-For` from the
  connection, which the login rate limit relies on.
- `.env.example`: every variable, copied to `.env` (mode 600) on the server. Compose reads it only
  to fill in the services' `environment`, so no service sees variables it doesn't use.
- The GitHub App key is mounted as a Compose secret at `/run/secrets/github-app`; the file must be
  readable by uid 1000 (the images' `node` user). Leave `GITHUB_APP_ID` empty to run without
  publishing.

## Run it

The full runbook, from the AWS account to operating the instance, is [`docs/deploy.md`](../../docs/deploy.md);
`bootstrap.sh` prepares a fresh Ubuntu VM (Docker, swap, security updates, `/opt/weft`). On the
VM this folder is all of the repository there is: a sparse checkout at `/opt/weft`, updated with
`git pull`, next to the `.env` and key file that never leave the server.

```bash
cp .env.example .env && chmod 600 .env    # fill it in
docker compose --profile image pull sandbox
docker compose pull && docker compose up -d
docker compose ps && docker compose logs -f worker
```

To try it on a development machine, build the images instead (`docker compose build`, or set
`WEFT_IMAGE` and `WEFT_TAG` to local tags) and use `WEFT_DOMAIN=localhost`, for which Caddy issues
a certificate from its own local authority (`curl -k`). Use a project name of your own
(`docker compose -p weft-local ...`) so it doesn't share containers or volumes with the
development Redis in `infra/compose.yml`.

## Images

Built from the repository root: `apps/api/Dockerfile`, `apps/worker/Dockerfile`,
`apps/web/Dockerfile`, and `infra/sandbox` for the sandbox.

- `turbo prune <app> --docker` copies only the app's workspace packages; dependencies install
  from the pruned lockfile before the sources are copied, so code changes reuse the install layer.
- api and worker run their TypeScript directly on Node 22 (type stripping), as in development,
  with production dependencies only. The worker image adds `git` and `tini`.
- web is a Next.js standalone build (`output: 'standalone'`, traced from the repository root).
- All run as `node` (uid 1000) and have health checks: api `/healthz`, web `/healthz` (outside
  the sign-in gate).

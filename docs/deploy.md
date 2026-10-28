# Deploying weft

weft runs on one Azure VM with Docker Compose: Caddy, web, api, worker and Redis, with Postgres on
Neon ([ADR 0012](decisions/0012-single-vm-deployment.md)). The stack itself is described in
[`infra/deploy`](../infra/deploy). This page is the runbook: create the VM, prepare it, configure
weft and start it.

Throughout, replace `<region>` with your Azure region, `<domain>` with the hostname weft will
serve (for example `weft.example.com`) and `<vm-ip>` with the VM's public IP.

## 1. Create the VM (Azure portal)

Create a resource group `weft-rg`, then a virtual machine in it:

| Setting            | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| Name               | `weft-vm`                                                            |
| Region             | `<region>`                                                           |
| Availability       | No infrastructure redundancy required                                |
| Security type      | Trusted launch                                                       |
| Image              | Ubuntu Server 24.04 LTS, x64 Gen2                                    |
| Size               | `Standard_B2ms` (2 vCPU, 8 GB)                                       |
| Authentication     | SSH public key, username `azureuser`                                 |
| Public ports       | None (rules are added below)                                         |
| OS disk            | 64 GB Standard SSD, delete with VM                                   |
| Networking         | New virtual network, new public IP (Standard SKU, static)            |
| NIC security group | Basic                                                                |
| Monitoring         | Boot diagnostics with a managed storage account; everything else off |
| Backup             | Off (the VM holds no data worth backing up; see below)               |

Optional, to stretch credits: **Auto-shutdown** under Management stops the VM every night. A
stopped (deallocated) VM costs only its disk and IP.

Then, in the VM's **Networking** settings, add inbound rules to its network security group:

| Priority | Port      | Source          | Purpose                                |
| -------- | --------- | --------------- | -------------------------------------- |
| 100      | 443 (TCP) | Any             | HTTPS                                  |
| 110      | 443 (UDP) | Any             | HTTP/3                                 |
| 120      | 80 (TCP)  | Any             | Let's Encrypt challenges and redirects |
| 130      | 22 (TCP)  | Your IP (`/32`) | SSH for you only                       |

Everything else stays denied. Never open 3000, 3001 or 6379: those services are reachable only
inside Docker.

## 2. Point DNS at it

At your DNS provider, add an `A` record for `<domain>` pointing to `<vm-ip>` (TTL 300). Do this
before the first start: Caddy asks Let's Encrypt for a certificate as soon as it starts, and that
needs the name to resolve to the VM.

```bash
dig +short <domain>    # should print <vm-ip>
```

## 3. Set a budget alert

On fixed credits this is the most important alarm. **Cost Management → Budgets → Add**: scope the
subscription, a monthly budget equal to what you want to spend, and email alerts at 50%, 80% and
100% of actual cost.

## 4. Prepare the VM

From the repository:

```bash
scp infra/deploy/bootstrap.sh azureuser@<vm-ip>:
ssh azureuser@<vm-ip> 'sudo bash bootstrap.sh'
```

`bootstrap.sh` installs Docker Engine and the Compose plugin from Docker's repository, sets log
rotation and `live-restore`, adds a 4 GB swap file (sandboxes run with swap off; swap is for host
processes), enables unattended security upgrades, adds `azureuser` to the `docker` group and
creates `/opt/weft`. It prints `DOCKER_GID=...` for the next step. It is safe to run again.

## 5. Configure weft

The VM keeps a clone of the repository; the stack runs from `infra/deploy` inside it, where
`.env` and the key file sit next to `compose.yml` (both are ignored by git). Log in again after
`bootstrap.sh` so the `docker` group applies, then:

```bash
ssh azureuser@<vm-ip> 'git clone https://github.com/avichal-08/weft.git /opt/weft'
scp ~/.config/weft/github-app.pem azureuser@<vm-ip>:/opt/weft/infra/deploy/github-app.pem
```

Make the secrets on your own machine, not on the VM:

```bash
pnpm --filter @weft/web auth:hash    # prints WEFT_PASSWORD_HASH=scrypt:...
openssl rand -base64 32              # SESSION_SECRET
```

Then on the VM:

```bash
cd /opt/weft/infra/deploy
cp .env.example .env && chmod 600 .env
chmod 400 github-app.pem             # owned by azureuser, uid 1000, the containers' node user
nano .env
```

| Variable                               | Value                                                 |
| -------------------------------------- | ----------------------------------------------------- |
| `WEFT_DOMAIN`                          | `<domain>`                                            |
| `WEFT_IMAGE`, `WEFT_TAG`               | `ghcr.io/avichal-08/weft`, `latest` (or a commit sha) |
| `SANDBOX_IMAGE`                        | `ghcr.io/avichal-08/weft-sandbox:latest`              |
| `DOCKER_GID`                           | from `bootstrap.sh`                                   |
| `WEFT_PASSWORD_HASH`, `SESSION_SECRET` | from above                                            |
| `DATABASE_URL`                         | Neon's pooled connection string                       |
| `LLM_PROVIDER`, `LLM_MODEL`, a key     | the default model and its API key                     |
| `GITHUB_APP_ID`                        | the GitHub App's id (empty disables publishing)       |
| `GITHUB_APP_PRIVATE_KEY_FILE`          | `./github-app.pem` (in `infra/deploy`)                |

Keep a copy of `.env` in your password manager: it is the only thing on the VM that can't be
recreated from the repository. The database is on Neon, Redis only holds queues and live
streams (runs are requeued from Postgres on start), and the install cache rebuilds itself.

If the uid of `azureuser` isn't 1000 (`id -u`), run `sudo chown 1000:1000 github-app.pem`.

Check the migrations are applied to the Neon database from your machine (`pnpm db:migrate`); the
containers don't migrate on start.

## 6. Start it

CI builds the images on every push to `main` once the checks pass, and publishes them to GitHub's
container registry as `ghcr.io/avichal-08/weft-{web,api,worker,sandbox}`, tagged `latest` and with
the full commit sha. The first time, make the four packages public (GitHub → your profile →
Packages → each package → Package settings → Change visibility); they contain no secrets. To keep
them private instead, log the VM in once with a token that has only `read:packages`:
`docker login ghcr.io -u avichal-08`.

On the VM:

```bash
cd /opt/weft/infra/deploy
docker compose --profile image pull sandbox
docker compose pull
docker compose up -d
docker compose ps
```

All services should be `running`, and web and api `healthy`. Then open `https://<domain>`, sign
in, and send an Ask-mode question about a public repository to check the whole path.

```bash
curl -s https://<domain>/healthz           # {"ok":true}
curl -sI http://<domain>/ | head -1        # 308, redirect to https
docker compose logs -f worker              # each turn's steps and timings
```

## Operating

| Task                | Command                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Logs                | `docker compose logs -f --tail 100 <service>`                                                                                               |
| Deploy the latest   | `cd /opt/weft && git pull && cd infra/deploy && docker compose --profile image pull sandbox && docker compose pull && docker compose up -d` |
| Pin or roll back    | set `WEFT_TAG` (and the sandbox tag) to a commit sha, then `docker compose pull && docker compose up -d`                                    |
| Restart one service | `docker compose restart <service>`                                                                                                          |
| Resource use        | `docker stats`, `free -h`, `docker system df`                                                                                               |
| Stop, keep data     | `docker compose stop`                                                                                                                       |
| Save credits        | `az vm deallocate -g weft-rg -n weft-vm`, later `az vm start -g weft-rg -n weft-vm`                                                         |
| Sign out everywhere | change `SESSION_SECRET`, then `docker compose up -d web`                                                                                    |
| Change the password | new `WEFT_PASSWORD_HASH`, then `docker compose up -d web`                                                                                   |

Wait for the commit's CI run to finish before deploying it: `latest` moves only once its images
are published. `git pull` brings changes to `compose.yml` and the `Caddyfile`; the images bring
everything else. Run `docker image prune -f` now and then to drop old image layers.

A redeploy waits up to 10 minutes for active turns to finish (`stop_grace_period`). A deallocated
VM keeps its static IP, so DNS stays valid.

## Troubleshooting

- **No certificate / browser warning:** DNS doesn't resolve to the VM yet, or port 80 is closed;
  `docker compose logs caddy` shows the ACME error. Caddy retries on its own.
- **502 from Caddy:** web isn't healthy; `docker compose ps` and `docker compose logs web`.
- **Sign-in says it isn't configured:** `WEFT_PASSWORD_HASH` or `SESSION_SECRET` is empty, or the
  secret is shorter than 32 characters.
- **Turns fail with `setup_failed` or are killed:** memory or disk; `docker stats` while a turn
  runs, `df -h`. Lower `WORKER_CONCURRENCY` and `SESSION_SANDBOXES_MAX` to 1 if memory is tight.
- **Worker can't reach Docker** (`EACCES /var/run/docker.sock`): `DOCKER_GID` doesn't match
  `getent group docker`.
- **Publishing fails:** the GitHub App isn't installed on that repository, or the key file isn't
  readable by uid 1000.

# Deploying weft

weft runs on one AWS EC2 instance with Docker Compose: Caddy, web, api, worker and Redis, with
Postgres on Neon ([ADR 0012](decisions/0012-single-vm-deployment.md),
[ADR 0013](decisions/0013-hosting-on-aws-ec2.md)). The stack itself is described in
[`infra/deploy`](../infra/deploy). This page is the runbook: set up the account, launch the
instance, prepare it, configure weft and start it.

Throughout, replace `<domain>` with the hostname weft will serve (for example
`weft.example.com`), `<ip>` with the instance's Elastic IP and `<instance-id>` with its id
(`i-...`). The region is `ap-south-1` (Mumbai); pick it in the console's region menu before each
step.

## 1. Set up the account

1. **Sign up** at aws.amazon.com and choose the **Free plan**: up to $200 in credits, no charges,
   and the account closes after six months or when the credits run out.
2. **Protect the root user:** account menu → Security credentials → assign an MFA device. Use the
   root user only for billing and account settings from here on.
3. **Create your everyday login** with IAM Identity Center: enable it in `ap-south-1`, add a user
   for yourself, create a permission set from the `AdministratorAccess` policy, and assign that
   user and permission set to the account. Sign in through the AWS access portal URL Identity
   Center shows, and set up MFA when asked.
4. **Set a budget:** Billing and Cost Management → Budgets → Create budget → a monthly cost budget
   of $70, with email alerts at 50%, 80% and 100% of actual cost. Under advanced options, untick
   **Credits** so the budget tracks what you use before credits are applied; otherwise it reads
   zero until they are gone. Creating a budget is also one of the Free plan's activities that
   earns extra credits (see Billing → Credits for the rest).

## 2. Launch the instance

**Create the instance role** first. IAM → Roles → Create role → trusted entity **AWS service**,
use case **EC2** → attach the `AmazonSSMManagedInstanceCore` policy → name it `weft-ec2-ssm`. This
lets Session Manager reach the instance, so it needs no SSH key or open port.

Then EC2 → Instances → **Launch instances**:

| Setting                         | Value                                                       |
| ------------------------------- | ----------------------------------------------------------- |
| Name                            | `weft`                                                      |
| Image                           | Ubuntu Server 24.04 LTS (HVM), SSD, 64-bit (x86)            |
| Instance type                   | `m7i-flex.large` (2 vCPU, 8 GiB, marked free tier eligible) |
| Key pair                        | Proceed without a key pair                                  |
| Network                         | default VPC, a public subnet, auto-assign public IP enabled |
| Firewall                        | create a security group `weft-web` (rules below)            |
| Storage                         | 40 GiB, gp3                                                 |
| Advanced → IAM instance profile | `weft-ec2-ssm`                                              |
| Advanced → Metadata version     | V2 only (token required), the default                       |

Security group `weft-web`, inbound rules (outbound stays "all traffic"):

| Type   | Protocol | Port | Source                 | Purpose                                |
| ------ | -------- | ---- | ---------------------- | -------------------------------------- |
| HTTPS  | TCP      | 443  | `0.0.0.0/0` and `::/0` | HTTPS                                  |
| Custom | UDP      | 443  | `0.0.0.0/0` and `::/0` | HTTP/3                                 |
| HTTP   | TCP      | 80   | `0.0.0.0/0` and `::/0` | Let's Encrypt challenges and redirects |

There is no rule for port 22. Never add 3000, 3001 or 6379: those services are reachable only
inside Docker.

**Give it a fixed address:** EC2 → Elastic IPs → Allocate → then Actions → Associate with the
`weft` instance. That address is `<ip>`; it stays the same when the instance is stopped and
started.

## 3. Point DNS at it

At your DNS provider, add an `A` record for `<domain>` pointing to `<ip>` (TTL 300). Do this
before the first start: Caddy asks Let's Encrypt for a certificate as soon as it starts, and that
needs the name to resolve to the instance.

```bash
dig +short <domain>    # should print <ip>
```

## 4. Connect and prepare the instance

Connect with **Session Manager**: EC2 → the instance → Connect → Session Manager → Connect. (If it
says the instance isn't connected, wait two minutes after launch, and check the IAM role is
attached.) From your machine with the AWS CLI and its Session Manager plugin installed, the same
is `aws ssm start-session --target <instance-id> --region ap-south-1`.

Sessions start as `ssm-user`; switch to the image's `ubuntu` user (uid 1000, the same as the
containers' `node` user) and fetch weft's deploy folder:

```bash
sudo su - ubuntu
sudo install -d -o ubuntu -g ubuntu /opt/weft
git clone --filter=blob:none --no-checkout https://github.com/avichal-08/weft.git /opt/weft
cd /opt/weft
git sparse-checkout set --no-cone '/infra/deploy/'
git checkout main
find . -path ./.git -prune -o -type f -print    # only infra/deploy/*
```

The instance runs images, not source code, so it keeps only the `infra/deploy` folder: a sparse
checkout, which still updates with `git pull`. `--filter=blob:none` skips downloading everything
else, and the `--no-cone` pattern limits the working tree to exactly that folder. The `build:`
sections in `compose.yml` refer to the rest of the repository, so the instance can't build images;
it only pulls them. To build there in an emergency, widen the checkout with
`git sparse-checkout disable` (and set it back afterwards).

Then prepare the machine:

```bash
sudo bash /opt/weft/infra/deploy/bootstrap.sh
exit                  # back to ssm-user
sudo su - ubuntu      # log in again so the docker group applies
docker ps             # works without sudo
```

`bootstrap.sh` installs Docker Engine and the Compose plugin from Docker's repository, sets log
rotation and `live-restore`, adds a 4 GB swap file (sandboxes run with swap off; swap is for host
processes), enables unattended security upgrades, adds `ubuntu` to the `docker` group and creates
`/opt/weft`. It prints `DOCKER_GID=...` for the next step. It is safe to run again.

## 5. Configure weft

Make the secrets on your own machine, not on the instance:

```bash
pnpm --filter @weft/web auth:hash    # prints WEFT_PASSWORD_HASH=scrypt:...
openssl rand -base64 32              # SESSION_SECRET
```

Use a different password from any local one, and keep it in your password manager.

On the instance, as `ubuntu`:

```bash
cd /opt/weft/infra/deploy
cp .env.example .env && chmod 600 .env
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
| `GITHUB_APP_PRIVATE_KEY_FILE`          | `./github-app.pem`                                    |

The GitHub App key goes next to it. With no SSH there is no `scp`; paste it into the session
instead (print it locally with `cat ~/.config/weft/github-app.pem`):

```bash
nano github-app.pem      # paste the whole key, including the BEGIN and END lines
chmod 400 github-app.pem
```

Keep a copy of `.env` in your password manager: it is the only thing on the instance that can't
be recreated from the repository. The database is on Neon, Redis only holds queues and live
streams (runs are requeued from Postgres on start), and the install cache rebuilds itself.

Check the migrations are applied to the Neon database from your machine (`pnpm db:migrate`); the
containers don't migrate on start.

## 6. Start it

CI builds the images on every push to `main` once the checks pass, and publishes them to GitHub's
container registry as `ghcr.io/avichal-08/weft-{web,api,worker,sandbox}`, tagged `latest` and with
the full commit sha. The first time, make the four packages public (GitHub → your profile →
Packages → each package → Package settings → Change visibility); they contain no secrets. To keep
them private instead, log the instance in once with a token that has only `read:packages`:
`docker login ghcr.io -u avichal-08`.

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
| Connect             | EC2 console → Connect → Session Manager, or `aws ssm start-session --target <instance-id>`; then `sudo su - ubuntu`                         |
| Logs                | `docker compose logs -f --tail 100 <service>`                                                                                               |
| Deploy the latest   | `cd /opt/weft && git pull && cd infra/deploy && docker compose --profile image pull sandbox && docker compose pull && docker compose up -d` |
| Pin or roll back    | set `WEFT_TAG` (and the sandbox tag) to a commit sha, then `docker compose pull && docker compose up -d`                                    |
| Restart one service | `docker compose restart <service>`                                                                                                          |
| Resource use        | `docker stats`, `free -h`, `docker system df`                                                                                               |
| Stop, keep data     | `docker compose stop`                                                                                                                       |
| Save credits        | `aws ec2 stop-instances --instance-ids <instance-id>`, later `aws ec2 start-instances --instance-ids <instance-id>` (or the console)        |
| Sign out everywhere | change `SESSION_SECRET`, then `docker compose up -d web`                                                                                    |
| Change the password | new `WEFT_PASSWORD_HASH`, then `docker compose up -d web`                                                                                   |
| Remaining credits   | Billing and Cost Management → Credits                                                                                                       |

Wait for the commit's CI run to finish before deploying it: `latest` moves only once its images
are published. `git pull` updates only `infra/deploy` (`compose.yml`, the `Caddyfile`); the images
bring everything else. Run `docker image prune -f` now and then to drop old image layers.

A redeploy waits up to 10 minutes for active turns to finish (`stop_grace_period`). The stack
starts again by itself when the instance starts (`restart: unless-stopped`). A stopped instance
costs only its volume and Elastic IP, and keeps the IP, so DNS stays valid.

## Troubleshooting

- **Session Manager can't connect:** the instance has no IAM role, or no route to the internet (it
  needs outbound HTTPS to reach the SSM service); check the role, the public IP and the subnet's
  route to an internet gateway.
- **No certificate / browser warning:** DNS doesn't resolve to the Elastic IP yet, or port 80 is
  closed in the security group; `docker compose logs caddy` shows the ACME error. Caddy retries on
  its own.
- **502 from Caddy:** web isn't healthy; `docker compose ps` and `docker compose logs web`.
- **Sign-in says it isn't configured:** `WEFT_PASSWORD_HASH` or `SESSION_SECRET` is empty, or the
  secret is shorter than 32 characters.
- **Turns fail with `setup_failed` or are killed:** memory or disk; `docker stats` while a turn
  runs, `df -h`. Lower `WORKER_CONCURRENCY` and `SESSION_SANDBOXES_MAX` to 1 if memory is tight.
- **Worker can't reach Docker** (`EACCES /var/run/docker.sock`): `DOCKER_GID` doesn't match
  `getent group docker`.
- **Publishing fails:** the GitHub App isn't installed on that repository, or the key file isn't
  readable by uid 1000 (`ls -ln github-app.pem` should show 1000; `sudo chown 1000:1000` if not).
- **An instance type is greyed out at launch:** Free plan accounts can only launch types marked
  free tier eligible; `m7i-flex.large` is one of them.

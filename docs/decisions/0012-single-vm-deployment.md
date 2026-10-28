# 0012. Deploying on one VM with Docker Compose

- Status: Accepted; the choice of Azure superseded by [0013](0013-hosting-on-aws-ec2.md)
- Date: 2026-10-28

## Context

weft is deployed for one user on fixed Azure credits. Its worker is unusual: every turn creates
sandbox containers and dependency images, so it needs a Docker daemon. Azure's managed container
services (Container Apps, App Service, Container Instances) don't offer privileged containers or a
Docker socket, so the worker needs a VM or Kubernetes nodes either way.

## Decision

- **One `Standard_B2ms` VM** (2 vCPU, 8 GB) dedicated to weft, running Docker Compose
  (`infra/deploy/compose.yml`): Caddy, web, api, worker and Redis. Postgres stays on Neon.
- **Only Caddy is published**, on 80 and 443, with automatic Let's Encrypt certificates and HTTP
  redirected to HTTPS. web, api and Redis are on the Compose network only; the browser only ever
  talks to web, which calls the API from its server.
- **The worker gets the host's Docker socket** and the host's `docker` group (`group_add`), running
  as the image's unprivileged `node` user, so it can create sibling sandbox containers. That makes
  it root-equivalent on the VM, which is acceptable only because the VM runs nothing but weft.
- **Least privilege for secrets.** Each service gets only the variables it needs from one `.env`
  (web: the sign-in hash and session secret; api and worker: the database and LLM keys; only the
  worker: the GitHub App key, as a Compose secret).
- **Images from CI, not built on the VM.** Each app has a Dockerfile that uses `turbo prune` to copy
  only its workspace packages and installs production dependencies; web uses Next.js standalone
  output. The sandbox image is pulled like the others.
- **Startup reconciliation.** On boot the worker requeues runs that are `queued` or `running` in
  Postgres but have no live job in Redis, so losing Redis or a crash never strands a run.
- **Bounded services:** memory limits per container, rotated logs, `restart: unless-stopped`, and a
  10-minute stop grace period so active turns finish on a redeploy.

## Alternatives considered

**Container Apps for web and api, a VM for the worker.** Managed TLS, built-in authentication and
scale-to-zero, but a virtual network between them, two deployment targets and more cost on fixed
credits, for one user.

**Kubernetes (AKS).** The usual answer at scale, with a node pool for Docker-capable workers, but
a control plane and node costs far beyond the budget and much more to operate for one machine's
worth of work.

**Running the worker on the host with systemd.** Avoids the socket mount, but has the same
privilege (membership in the `docker` group) and a second way of deploying.

**Sharing the VM with other projects.** Cheaper, but the worker's Docker access would extend to
them.

## Consequences

- One machine to operate and pay for; no high availability, which one user doesn't need.
- A compromised worker or sandbox escape compromises the VM, not other systems; secrets on it are
  limited to weft's own.
- Moving to managed containers or Kubernetes later keeps the same images and environment
  variables; only the orchestration changes.

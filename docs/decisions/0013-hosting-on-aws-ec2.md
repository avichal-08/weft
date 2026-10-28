# 0013. Hosting on AWS EC2

- Status: Accepted
- Date: 2026-10-28

## Context

[0012](0012-single-vm-deployment.md) runs weft on one VM with Docker Compose. That needs a
machine with enough memory for the services plus the sandboxes they create, a stable address for
DNS and TLS, and a way for the operator to reach a shell without exposing it to the internet.

Sizing comes from the workload: the services themselves use about 0.6 GB, and each sandbox gets
up to 2 GB while installing dependencies and running tests. Two concurrent sandboxes, as
configured in `compose.yml`, need about 8 GB. CPU is idle most of the time and busy in short
bursts while dependencies install and tests run.

## Decision

- **AWS EC2, one `m7i-flex.large`** (2 vCPU, 8 GiB, x86) running Ubuntu 24.04 LTS, with a 40 GiB
  gp3 volume. Flex instances run at a 40% CPU baseline and burst above it, which matches a
  mostly idle, bursty workload, and x86 matches the images CI builds. The deployment is in
  `ap-southeast-2`; nothing depends on the region.
- **An Elastic IP**, so the address, and with it DNS and the certificate, survives stopping and
  starting the instance.
- **A security group** that allows 80 and 443 (TCP, and UDP for HTTP/3) from anywhere and SSH only
  from the operator's address (`/32`). Nothing else is reachable; the services behind Caddy are
  not published at all.
- **SSH with an ED25519 key pair** created at launch; Ubuntu's images accept key authentication
  only.
- **SSM Session Manager as the fallback.** An instance role with `AmazonSSMManagedInstanceCore`
  lets the operator open a shell from the console or the CLI when the SSH rule no longer matches
  their address or the key is unavailable, without widening the security group.
- **Account hygiene:** MFA on the root user, day-to-day access through IAM Identity Center, and an
  AWS Budget with alerts before spending reaches its limit.

## Alternatives considered

**Session Manager only, no inbound SSH.** No open management port, no key to manage and sessions
logged in CloudTrail, but it needs the CLI plugin for terminal use and gives up `scp`, which the
runbook uses to place the GitHub App key.

**SSH open to `0.0.0.0/0`.** No rule to update when the operator's address changes, but every SSH
scanner on the internet would reach the instance.

**A smaller instance** (2 or 4 GiB). Cheaper, but dependency installs inside sandboxes would fail
on larger repositories, and only one sandbox could run at a time.

**ARM (Graviton).** Better price per hour, but every image, the sandbox included, would need
multi-architecture builds.

**ECS or EKS.** The managed ways to run containers on AWS, but the worker needs a Docker daemon it
controls, which Fargate doesn't offer, and a cluster is far more than one machine's worth of work.

## Consequences

- Shell access depends on the SSH rule matching the operator's address; when it changes, the rule
  is updated in the console, and Session Manager works in the meantime.
- Stopping the instance when it isn't needed leaves only the volume and the Elastic IP to pay for,
  and keeps the address, so the site comes back on start without DNS changes.
- The setup above the VM (Compose stack, images, `bootstrap.sh`, configuration) is
  provider-neutral; moving clouds means repeating only the first steps of
  [`docs/deploy.md`](../deploy.md).

# 0013. Hosting on AWS EC2, reached through Session Manager

- Status: Accepted; shell access superseded by [0014](0014-ssh-access.md)
- Date: 2026-10-28
- Supersedes the choice of Azure in [0012](0012-single-vm-deployment.md); the single-VM topology stands

## Context

[0012](0012-single-vm-deployment.md) put weft on one VM running Docker Compose and picked an Azure
`Standard_B2ms`. weft is a portfolio and learning project with one user, not a product that has
to stay up: a deployment that runs for some months and teaches a widely used cloud is worth more
than the longest possible uptime. The owner already runs another project on Azure and has not
used AWS.

New AWS accounts (opened on or after 15 July 2025) can choose a Free plan: up to $200 in credits,
no charges, and the account closes after six months or when the credits run out. A Free plan
account can only launch instance types marked free-tier eligible: `t3.micro`, `t3.small`,
`t4g.micro`, `t4g.small`, `c7i-flex.large` and `m7i-flex.large`. Their running hours are paid
from the credits.

## Decision

- **AWS, region `ap-southeast-2` (Sydney)**, on the Free plan. Mumbai and Singapore would be closer
  to the owner in India, but the Free plan offered this account only Sydney. Pages take about
  150 ms more to reach than from a nearby region, which matters little next to agent turns that
  take seconds.
- **One `m7i-flex.large` instance** (2 vCPU, 8 GiB, x86), the only eligible type with the memory
  0012 sized for, running Ubuntu 24.04 with a 40 GB gp3 volume. x86 keeps the images CI already
  builds.
- **An Elastic IP**, so the address and DNS survive stopping the instance.
- **No inbound SSH.** The security group allows only 80 and 443 (TCP and UDP for HTTP/3). Shell
  access is through **SSM Session Manager**: the instance has an IAM role with
  `AmazonSSMManagedInstanceCore`, and the SSM agent preinstalled on Ubuntu's AMIs connects out to
  AWS. No key pair is created.
- **Account hygiene:** MFA on the root user, daily work as an IAM Identity Center user with an
  administrator permission set, and an AWS Budget that alerts before the credits run out.
- **Stopped when not in use.** A stopped instance costs only its volume and Elastic IP, which
  stretches the credits across the plan's six months.
- Everything above the VM is unchanged: the Compose stack, the images from CI, `bootstrap.sh`, the
  sparse checkout and the manual deploy.

## Alternatives considered

**Azure `Standard_B2ms`**, as in 0012. About $20 a month for the owner and no expiry, so cheaper
over a year and the better choice for a service that must stay up; but no new platform learned.

**A smaller eligible type** (`t3.small`, `c7i-flex.large` with 4 GiB). Stretches the credits, but
dependency installs inside sandboxes need the memory; 4 GiB would mean one sandbox at a time and
installs failing on larger repositories.

**ARM (`t4g`)**. Cheaper per hour, but the eligible ARM sizes have at most 2 GiB, and the images
would need multi-architecture builds.

**SSH with a key and the port open to one IP.** Familiar, but a key to manage, a port to keep
restricted as home IPs change, and no session log. Session Manager removes all three.

**ECS or EKS.** The managed way to run containers on AWS, but the worker needs a Docker daemon it
controls, which Fargate doesn't offer, and a cluster is far more than one user needs. Covered as a
learning exercise separately.

## Consequences

- No open management port; access is controlled by IAM and recorded in CloudTrail.
- Running all the time, the credits last roughly two and a half to three months; stopped when
  idle, the full six months.
- When the Free plan ends the account closes and weft goes offline, which is acceptable for this
  project. Moving back to Azure or another VM needs only the runbook's first steps; the stack and
  `.env` carry over.
- Copying files to the instance goes through the session (pasting) rather than `scp`.

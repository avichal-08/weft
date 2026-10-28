# 0014. SSH access with a key, restricted to the owner's IP

- Status: Accepted
- Date: 2026-10-29
- Supersedes the "no inbound SSH" part of [0013](0013-hosting-on-aws-ec2.md)

## Context

[0013](0013-hosting-on-aws-ec2.md) chose SSM Session Manager and no inbound port for shell access.
When the instance was launched, the owner preferred SSH: it is the access method used for their
other VM, works with `scp` and every terminal, and needs no AWS CLI plugin or IAM role to set up.

## Decision

- **SSH with an ED25519 key pair** created by EC2 at launch (`weft`), kept on the owner's machine
  with mode 400. No passwords: Ubuntu's AMIs allow key authentication only.
- **Port 22 open to the owner's IP only** (`/32`) in the security group; 80 and 443 stay open to
  everyone, nothing else is open.
- **Session Manager stays available as a fallback:** attaching the `weft-ec2-ssm` role (with
  `AmazonSSMManagedInstanceCore`) gives a way in when the home IP changes or the key is lost,
  without opening the port wider.

## Alternatives considered

**Session Manager only**, as 0013 decided: no open port, no key and sessions logged in CloudTrail,
but an IAM role, a CLI plugin and pasting instead of `scp`.

**SSH open to `0.0.0.0/0`.** No rule to update when the IP changes, but every SSH scanner on the
internet would reach the instance.

## Consequences

- A dynamic home IP breaks SSH until the rule is updated (EC2 → Security Groups → edit the SSH rule
  to "My IP"); with the role attached, Session Manager still works meanwhile.
- The key file is the only credential for SSH; losing it means using Session Manager or replacing
  the key through it.

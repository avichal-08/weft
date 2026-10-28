# 0008. Ask mode: read-only turns enforced by the tool set

- Status: Accepted
- Date: 2026-10-28

## Context

A chat message can be a question or a request for a change, and the agent decides which from the
wording. The system prompt says to answer questions without editing files, but a prompt rule is
a request, not a guarantee. The eval ([0007](0007-agent-evals.md)) caught it failing: asked a
question about a test, `gemini-3.1-flash-lite` edited `test/money.test.js` in both runs of the
case.

The loop also executed any known tool the model called, even one it had not been offered. With
no test command, `run_tests` was hidden from the model but still ran if called.

## Decision

- **A per-message mode, `code` (default) or `ask`.** The user picks it when sending; the agent
  never guesses it.
- **Ask mode offers only read-only tools:** `grep`, `glob`, `view_file` and `finish`. Commands
  and tests are excluded as well as edits, because a command can write files (`sed -i`, test
  snapshots, coverage output).
- **The loop refuses tools it did not offer**, in every mode. A refused call returns an error to
  the model, which can carry on; nothing is executed.
- **The prompt says the turn is read-only**, and that a request for a change should be answered
  with what would change and where, and a suggestion to switch to Code mode.
- Later steps carry the mode through the API, database and worker, give the composer a toggle,
  and have the worker record no diff for an Ask turn as a second check.

## Alternatives considered

**A better prompt only.** Cheapest, and it may reduce the failure, but it stays probabilistic;
the eval already showed the model ignoring this exact rule.

**Classify each message as a question or a change** with a model call or patterns. No extra
click, but a misclassified change request would fail silently, a misclassified question would
still edit, and it adds a call per turn.

**Allow read-only commands** (`ls`, `cat`, `git log`), as Claude Code's plan mode allows
read-only shell commands. More capable, but deciding which commands are read-only is a parser
for the shell, with easy bypasses. The read tools cover what questions need.

**Undo edits after the turn** instead of preventing them. Keeps the repository clean but still
spends steps on edits and lets the reply describe changes that were thrown away.

## Consequences

- An Ask turn cannot change the repository, independent of the model's behaviour.
- Ask mode can't run the tests or other commands; "do the tests pass?" is a Code-mode question.
- The user has to choose the mode; Code stays the default, so nothing changes for existing chats.
- Refusing tools that weren't offered also closes the hidden-`run_tests` gap in Code mode.

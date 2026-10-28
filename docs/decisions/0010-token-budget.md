# 0010. A token budget per turn

- Status: Accepted
- Date: 2026-10-28

## Context

A turn was bounded by `maxSteps` (default 30), which limits the number of model calls but not
what they cost. Every step resends the whole conversation, so a turn's tokens grow roughly with
the square of its steps, and a few steps that read large files can cost more than many small
ones. A 30-step turn on a real repository can process around a million tokens: about $3 of input
on Claude Sonnet at list price, from one turn, with nothing to stop it.

In the 53 eval runs recorded so far ([0007](0007-agent-evals.md)), a turn used 13.5k tokens at
the median, 40k at the 95th percentile and 45k at most; the eval fixtures are small, and real
repositories run several times larger.

## Decision

- **`tokenBudget` in `runAgent`**, the tokens a turn may process: input, cached input and output.
  Cached input is cheaper but still occupies the context.
- **Checked before each model call.** A step that replies is always finished normally; otherwise,
  once the budget is spent, the loop stops with status `budget`.
- **One warning at 80%**, added after that step's tool results: finish the current change and
  reply. A turn that wraps up beats one cut off mid-edit.
- **The worker treats `budget` like `max_steps`:** the turn fails with `failureKind: 'budget'`
  and keeps its diff, so the user sees what was done and can reply to continue.
- **Default 500k tokens**, about 11 times the largest eval turn: roughly $0.13 of input on
  `gemini-3.1-flash-lite` or $1.50 on Claude Sonnet. Set per worker with `TOKEN_BUDGET` and per
  chat with `config.tokenBudget` (10k to 5M).

## Alternatives considered

**A budget in dollars.** Closer to what matters, but it needs a price table per provider and
model in the worker, which goes stale; tokens are what every provider reports.

**A lower `maxSteps`.** Hurts legitimate long tasks and still doesn't bound cost.

**Only `maxTokens` per call.** That limits output, a small share of the cost; the input context
is what grows.

**No warning.** Simpler, but every budget stop would land mid-work.

**Rate limits on the API.** weft has no authentication and no public deployment, so a limit per
IP would protect nothing real; limits per user on turns and sandboxes belong with authentication.

## Consequences

- The worst case for one turn is known and configurable.
- A very large legitimate task may need a second message to finish; its work so far is kept.
- The warning costs one sentence of context, once per turn.
- There is still no limit per user or per chat across turns; that comes with authentication.

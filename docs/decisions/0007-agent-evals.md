# 0007. Evaluating the agent with a small suite of graded tasks

- Status: Accepted
- Date: 2026-10-28

## Context

Changes to the agent's prompt, tools or loop need to be judged by more than trying a few chats
by hand. Agents are not deterministic, and the failures that matter are not only wrong answers:

- claiming a change that was never made,
- editing files when the user only asked a question,
- making a fix pass by rewriting the tests it should satisfy,
- searching in the wrong language and giving up.

The suite also has to be cheap enough to run often. Runs use free-tier Gemini keys, where some
models allow only 20 requests a day.

## Decision

- **A small suite of our own tasks, not a public benchmark.** 17 cases in
  `packages/agent/eval/cases.ts` over two JavaScript fixtures: a small shop module, and a snapshot
  of the playground repository used for live tests. Categories: questions, bug fixes, features,
  follow-ups that carry earlier turns, and traps where the right answer is to change nothing or
  say the work already exists.
- **Each case runs in the real sandbox** with the real tools, from a committed fixture plus an
  optional seeded bug and prior turns, so a result reflects what a user would get.
- **Graded on outcomes, mostly by code, never by a model:**
  - **Fail-to-pass:** tests the agent never saw are added after the run and must pass.
  - **Pass-to-pass:** the original test files are restored before running them, so a fix can't
    pass by editing the tests it should satisfy.
  - **Edits:** files changed only when the task calls for it.
  - **Phantom edits:** a reply that claims a change when nothing changed fails.
  - **Required content:** reply mentions and file contents a case requires.
- **Rewritten test lines are measured, not failed.** The run stores the diff of existing test
  files. A removed line counts as rewritten unless an added line keeps all of its words in order,
  so extending an import or an assertion is fine, while changing an expected value, deleting an
  assertion, commenting it out or adding `.skip` is not. An earlier version counted every removed
  line, which flagged extended imports as rewrites.
- **Stored runs are re-scored.** Results are appended as JSONL with everything the graders need
  (reply, changed files, test results, test diff). The report re-grades them with the current
  graders, so fixing a grader never needs new model runs.
- **Repeats and consistency.** Cases run `--repeat` times, and the report counts cases that pass
  every repeat as well as the overall pass rate.
- **Cost at list price.** Tokens are recorded per run and priced at the paid-tier list price, with
  the source and date in `eval/pricing.ts`, even though runs use the free tier.
- **Built for quotas.** A daily-quota error stops the run, `--resume` skips finished runs, provider
  errors are recorded but not scored, and steps are capped at 15.

## Alternatives considered

**A public benchmark such as SWE-bench Verified.** Comparable with published numbers, but each
task needs a large repository, its own environment and many model calls. That is far beyond a
free-tier quota, and its tasks don't test conversations, questions or traps.

**An LLM judge.** It can grade open-ended answers, but adds cost and its own errors, and the
judge's model changes the score. Tests, file checks and patterns are cheaper and repeatable;
the price is that some answers are checked loosely (a reply must mention certain files or facts).

**Failing any run that touches existing tests.** Simple, but adding a test to an existing file is
often the right thing to do. Restoring the original tests before pass-to-pass already stops
tampering from passing, so rewrites are reported as a number rather than failed.

**Running only once per case.** Cheaper, but a single run can't separate a fix from luck.

## Consequences

- A change to the agent can be compared on pass rate, consistency, cost, time and steps, in one
  committed report (`packages/agent/eval/REPORT.md`).
- 17 cases with two repeats is a small sample: a difference of one or two runs is not evidence on
  its own, and the report should be read with that in mind.
- Free-tier timeouts and retries make wall time noisy; steps and tokens are more stable signals.
- Answers are graded by patterns, so a correct answer worded unexpectedly can fail and is fixed by
  adjusting the grader and re-scoring.
- The rewritten-lines check is a heuristic. A line kept word for word but moved into a different
  test would not count.

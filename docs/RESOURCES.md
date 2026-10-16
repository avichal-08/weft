# Resources

What I'm reading while building weft, grouped by the problem each one helps with.
★ = read this first. Everything else is reference for when you hit that problem.

---

## 1. Agents

### Fundamentals

- ★ [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (Anthropic): workflows vs agents, and why a plain loop beats a framework.
- [ReAct](https://arxiv.org/abs/2210.03629) (paper): where the reason → act → observe loop comes from. Skim it.

### Tool use (provider APIs)

- ★ [Claude tool use](https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview): tool schemas, `tool_use`/`tool_result`, parallel calls, stop reasons.
- [OpenAI function calling](https://platform.openai.com/docs/guides/function-calling): the other half of a provider-agnostic adapter. Diff it against the Claude docs.
- [Claude prompt caching](https://docs.claude.com/en/docs/build-with-claude/prompt-caching): the biggest lever on cost in a long agent loop.

---

## 2. Coding agents

### Design

- ★ [SWE-agent](https://arxiv.org/abs/2405.15793) (paper): the "agent–computer interface". Tool design moves results more than prompts do.
- ★ [Raising the bar on SWE-bench Verified](https://www.anthropic.com/engineering/swe-bench-sonnet) (Anthropic): a minimal agent (bash + edit tool) and why each tool is shaped the way it is.
- [Agentless](https://arxiv.org/abs/2407.01489) (paper): the counterpoint. A fixed localize → repair → validate pipeline is competitive.

### Claude Code (the reference design)

- ★ [Claude Code docs](https://docs.claude.com/en/docs/claude-code/overview): tools, subagents, memory files, compaction.
- [Claude Code best practices](https://www.anthropic.com/engineering/claude-code-best-practices): how the tool is meant to be driven, which tells you what the agent loop needs to support.
- [Latent Space: Claude Code episode](https://www.latent.space/p/claude-code): why agentic search (grep/glob/read) replaced RAG, from the people who built it.
- [AGENTS.md](https://agents.md): the cross-tool convention for repo instructions.

### Code worth reading

- ★ [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent): a working coding agent in roughly 100 lines. Read all of it.
- [OpenHands](https://github.com/All-Hands-AI/OpenHands) ([paper](https://arxiv.org/abs/2407.16741)): see the runtime / action server that runs inside the sandbox.
- [OpenAI Codex CLI](https://github.com/openai/codex): sandboxing and approval policies in a production agent.
- [Aider repo map](https://aider.chat/2023/10/22/repomap.html): a structural map of the code without embeddings. A good contrast to agentic search.

---

## 3. Context engineering

- ★ [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (Anthropic): compaction, note-taking, subagents.
- ★ [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) (Anthropic): output caps, error messages the model can act on, naming.
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (Anthropic): when subagents pay off, and their token cost.
- [Lost in the Middle](https://arxiv.org/abs/2307.03172) (paper): why stuffing more into context degrades results.

---

## 4. Evals and benchmarks

- ★ [SWE-bench](https://arxiv.org/abs/2310.06770) (paper): how coding tasks are built from real issues and verified with tests.
- [Introducing SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/) (OpenAI): why the raw benchmark was noisy and how they filtered it.
- ★ [Your AI product needs evals](https://hamel.dev/blog/posts/evals/) (Hamel Husain): read the trajectories before you trust any metric.
- [Task-specific LLM evals that do & don't work](https://eugeneyan.com/writing/evals/) (Eugene Yan): practical methodology.

Concepts to have straight: pass@1 vs pass@k, variance across repeated runs, ablation design, contamination.

---

## 5. Sandboxing and isolation

### Linux and Docker

- ★ [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/): CPU, memory and PID limits, and what happens when they hit.
- [Docker Engine API](https://docs.docker.com/reference/api/engine/): create / exec / attach. dockerode is a thin wrapper over it.
- man pages: [`cgroups(7)`](https://man7.org/linux/man-pages/man7/cgroups.7.html), [`namespaces(7)`](https://man7.org/linux/man-pages/man7/namespaces.7.html), [`capabilities(7)`](https://man7.org/linux/man-pages/man7/capabilities.7.html), [`setsid(2)`](https://man7.org/linux/man-pages/man2/setsid.2.html). Process groups are how you kill runaway children.

### Stronger isolation

- [gVisor docs](https://gvisor.dev/docs/): a user-space kernel, and the trade-offs vs runc.
- [Firecracker](https://www.usenix.org/conference/nsdi20/presentation/agache) (NSDI '20 paper): microVMs. The "why not Docker" argument.

### Agent security

- ★ [The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) (Simon Willison): private data + untrusted content + a way to send data out = exfiltration. The threat model in one post.
- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/): a checklist for SECURITY.md.

---

## 6. Distributed systems

### Correctness

- ★ [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) (Kleppmann): leases and fencing tokens, i.e. why a zombie worker must not be able to write.
- _Designing Data-Intensive Applications_, ch. 7–9: transactions, partial failure, consistency.
- [Exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) (AWS): retries that don't stampede.

### Queues and streams

- [BullMQ docs](https://docs.bullmq.io/): read the Workers, Stalled Jobs and Retrying sections.
- [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/): `XADD` / `XREAD BLOCK`, and replay for clients that reconnect.

---

## 7. Performance and observability

- ★ _How NOT to Measure Latency_ (Gil Tene, talk): percentiles and coordinated omission. Watch before writing the load test.
- [Prometheus histograms](https://prometheus.io/docs/practices/histograms/): how to compute p95 correctly.
- [OpenTelemetry docs](https://opentelemetry.io/docs/) and [GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/): span names and attributes for LLM calls.

---

## 8. GitHub integration

- [About creating GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps): App vs OAuth App vs PAT, and short-lived installation tokens.
- [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries): HMAC signature checks.

---

## 9. Stack docs

[Turborepo](https://turborepo.com/docs) · [Next.js](https://nextjs.org/docs) · [Drizzle](https://orm.drizzle.team/docs/overview) · [Zod](https://zod.dev) · [Vitest](https://vitest.dev)

---

## Books (optional, broader)

- _AI Engineering_ (Chip Huyen): evals, context and system design for LLM apps in one place.

# Proposal: making cardano402 easy for agents to navigate, adopt, and use

> Draft proposal for review — 2026-05-25. Not a commitment; pick the methods worth building.

## The one action that gates everything

Right now **no adoption method works live**, because the agent-payment endpoints
(`/verify`, `/settle`, `/health`, `/supported`) are blocked by a Cloudflare
Managed Challenge (audit C4). Until the WAF skip rule is applied (see
`docs/cloudflare-machine-api-waf.md`, PR #89), an agent literally cannot reach
the facilitator over HTTP. **This is the precondition for every method below.**

## What already exists (don't rebuild this)

cardano402 already has a strong discovery surface:

- **MCP server** — `@cardano402/mcp-server` (0.1.2 live, 0.1.3 in PR #88). The
  primary agent-native path: an MCP client connects and gets paid endpoints as tools.
- **Discovery manifests** — `/.well-known/x402.json`, `/.well-known/agent-card.json`,
  `/.well-known/ai-agent.json`, `/.well-known/mcp/server-card.json`.
- **Text discovery** — `/agents.txt`, `/robots.txt`, `/sitemap.xml`, `/SKILL.md`.
- **OpenAPI** — `/docs`.
- **SDK packages** — `@cardano402/core` + adapters: `axios`, `express`, `fastify`,
  `fetch`, `hono`, `next`.
- **Examples** — `examples/client.ts`, `examples/failure-modes.ts`.

So the *discovery layer is mature*. The real gaps are: **(a) reachability** (C4),
**(b) discoverability** (agents can't find the server unless told its URL),
**(c) turnkey adoption** (no packaged skill, no general CLI), and **(d) a
zero-install hosted option**.

---

## The methods you named — a plan for each

### 1. MCP (primary path — already exists; strengthen it)
**State:** published + hardened. The strongest agent adoption surface.
**Gaps:** not listed in any MCP registry (agents can't *discover* it); self-host only.
**Plan:**
- Add a `server.json` / MCP manifest and list in registries: the official MCP
  registry, Smithery, mcp.so, Glama, PulseMCP. *(This is the single highest-reach,
  lowest-effort item in this doc.)*
- Ship one-line connect snippets for Claude Desktop, Cursor, Windsurf, Cline.
- (Optional, medium effort) Host a **remote streamable-HTTP MCP** using the
  0.1.2 bearer-token + per-call/per-day spend limits, so agents connect without
  self-hosting a signer.
**Effort:** registry listings = hours; remote hosting = days.

### 2. REST API (exists; make it agent-consumable)
**State:** `/verify`, `/settle`, `/supported`, `/.well-known/*`, `/docs`. Behind C4.
**Gaps:** reachability (C4); no machine tool-schema for non-MCP function-calling agents.
**Plan:**
- Apply C4 (PR #89).
- Verify `/docs` OpenAPI is complete; generate a **function-calling tool manifest**
  (OpenAI tools / Anthropic tools JSON) from the catalog so any LLM can import
  endpoints without MCP.
- Add copy-paste `curl` for the raw 402→sign→retry flow to `/SKILL.md`.
**Effort:** low–medium.

### 3. CLI (gap — does not exist as a general pay tool)
**State:** `cardano402-mcp` is the MCP *server launcher*, not a `pay this URL` CLI.
**Plan:** build `@cardano402/cli` (or extend the existing bin) reusing the
mcp-server's `payment.ts` + `spend-tracker.ts`:
- `cardano402 discover <url>` — fetch + print the catalog/price list.
- `cardano402 pay <url> [--body @file]` — run one 402 cycle, print result + tx hash.
- `cardano402 balance` / `cardano402 whoami`.
Agents with shell/tool access (Claude Code, Openhandsm, etc.) just shell out to it.
Inherits the 0.1.2/0.1.3 spend caps + file-based seed handling for free.
**Effort:** medium (reuses existing payment internals).

### 4. SSH — honest assessment: **recommend against as a primary method**
SSH is a poor fit for agent payments: stateful sessions, key-management overhead,
no standard "agent SSH client," and pay-per-call semantics map awkwardly onto a
shell. The emerging "SSH app" pattern (ssh into a TUI) suits *interactive human*
UX, not programmatic agent commerce — and it duplicates what MCP and HTTP already
do better and more securely.
**If** the real driver is "agents already live in a shell," the clean answer is
the **CLI (#3) invoked over their existing shell**, not a bespoke SSH service.
**Recommendation:** skip SSH; the CLI covers that use case with less attack
surface and no new auth model.

---

## Methods you didn't name (worth considering)

| # | Method | Why it matters | Effort |
|---|--------|----------------|--------|
| A | **MCP registry listings** (official registry, Smithery, mcp.so, Glama, PulseMCP) | Discoverability — how agents *find* you vs. needing the URL. Biggest reach for least work. | Low |
| B | **`llms.txt`** (llmstxt.org) at `/llms.txt` | Emerging standard agents probe; complements `agents.txt`. | Low |
| C | **Function-calling tool manifest** (OpenAI/Anthropic tool JSON from the catalog) | Lets non-MCP function-calling LLMs import endpoints directly. | Low–Med |
| D | **Framework tool wrappers** (LangChain, LlamaIndex, Vercel AI SDK, OpenAI Agents SDK) | One-import adoption inside the framework an agent already uses. | Med |
| E | **Packaged Agent Skill bundle** (Claude Skill: `SKILL.md` + helper scripts, installable) | The modern "build a skill" — turnkey, distinct from the *served* `/SKILL.md` doc. | Med |
| F | **Hosted facilitator + preview-net sandbox** ("try it" endpoint + one-prompt demo) | An agent completes a real payment in seconds; removes self-host friction. | Med–High |
| G | **Agent-commerce directory listings** (x402 ecosystem indexes, agent registries) | Distribution where agents already shop for paid tools. | Low |
| H | **Copy-paste "agent onboarding prompt"** (one block pointing at `/SKILL.md` + `/.well-known`) | Lets any operator teach any agent cardano402 in one paste. | Trivial |

---

## Recommended sequencing

1. **C4 Cloudflare WAF rule** — precondition; apply PR #89's runbook. *(operator)*
2. **MCP registry listings** (#A) — highest reach, lowest effort; the server already exists + is hardened.
3. **Packaged Agent Skill bundle** (#E) — the turnkey "skill" you asked for.
4. **`@cardano402/cli`** (#3) — covers shell-access agents (and the SSH use case).
5. **Function-calling tool manifest (#C) + `llms.txt` (#B)** — broadens reach beyond MCP.
6. **Framework wrappers (#D) + hosted sandbox (#F)** — polish + distribution.

**Declined:** SSH (the CLI supersedes it).

---

## What you need to decide / do

- **Now (operator):** apply the Cloudflare WAF rule (PR #89). Nothing is live without it.
- **Decide:** self-host-only, or also offer a **hosted/remote MCP + preview-net sandbox**? This affects items 1, F, and the remote-MCP option in #1.
- **Approve scope:** recommend building items 1→4 in order. On approval, these are
  straightforward to implement (the CLI and skill reuse existing payment internals;
  registry listings are mostly manifest + submission).
- **Branding constraint reminder:** none of these should implement or name the
  trademarked third-party transfer method (see `protected-brand-name` rule).

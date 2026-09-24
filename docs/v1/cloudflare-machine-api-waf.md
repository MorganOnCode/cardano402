# Cloudflare: restore machine API access (audit C4)

> Operator/deployment task — no repo code change. Status as of 2026-05-25.

## Problem (verified live 2026-05-25)

`cardano402.com` sits behind Cloudflare. Cloudflare's bot protection issues a
**Managed Challenge** (the "Just a moment…" JavaScript interstitial) to clients
that don't look like a JS browser. Verified by probing each endpoint — the
blocked ones return **HTTP 403 with header `cf-mitigated: challenge`**:

| Path | To a non-browser (agent/SDK/curl) client |
|------|------------------------------------------|
| `/.well-known/x402.json`, `/.well-known/agent-card.json`, `/agents.txt` | ✅ 200 — already excepted |
| `/health`, `/supported`, `/verify`, `/settle`, `/SKILL.md` | ⛔ 403 `cf-mitigated: challenge` |

**Why this matters:** a Managed Challenge can only be solved by executing
JavaScript in a browser. Agents, SDKs, and `curl` have no JS engine, so they can
*never* pass it. For an agent-native x402 facilitator, `/verify` and `/settle`
**must** be reachable by non-browser HTTP clients — this challenge makes the core
product unusable for its intended callers. It is a Cloudflare configuration
issue, not an application bug (the request never reaches the origin).

## Step 1 — Identify which Cloudflare product is challenging

Dashboard → **Security → Events**, filter `Path = /verify`. On the row with
**Action = Managed Challenge**, read the **Service / Source**. It is one of:

- **Super Bot Fight Mode** (Pro+) or **Bot Fight Mode** (Free) — most likely
- **Browser Integrity Check** (BIC)
- **Security Level = "I'm Under Attack"**
- A **WAF custom rule** with action `Managed Challenge`
- A **WAF Managed Ruleset** rule

The fix below covers the common sources; confirm the source first because it
determines which toggles to skip (and whether your plan can do it — see caveats).

## Step 2 — Add a WAF Skip rule for the machine API paths

A Skip rule is a path-scoped exception: "for these URLs, don't run the bot
challenge; forward straight to origin." It is scoped to the API paths **only**,
so human-facing pages keep their protection.

Dashboard → **Security → WAF → Custom rules → Create rule**:

- **Name:** `Skip challenge for x402 machine API`
- **Expression** (Edit expression):
  ```
  (http.request.uri.path in {"/health" "/supported" "/verify" "/settle" "/status" "/SKILL.md"})
  ```
- **Action:** `Skip` → under **"Skip the following"** enable the ones matching Step 1:
  - **Browser Integrity Check**
  - **Security Level**
  - **Super Bot Fight Mode** (if that's the source)
  - "All remaining custom rules" *(only if a later custom rule issues the challenge)*
- **Order:** place this rule **above** any custom rule that issues the challenge
  (Skip only affects rules evaluated *after* it).

## Step 3 — Terraform (if managing Cloudflare as IaC; use instead of Step 2)

```hcl
resource "cloudflare_ruleset" "x402_machine_api_skip" {
  zone_id     = var.cloudflare_zone_id
  name        = "x402 machine API skip challenge"
  description = "Allow non-browser agent clients to reach the x402 facilitator API (audit C4)"
  kind        = "zone"
  phase       = "http_request_firewall_custom"

  rules {
    ref         = "skip_challenge_machine_api"
    description = "Skip browser challenges on x402 machine endpoints"
    expression  = "(http.request.uri.path in {\"/health\" \"/supported\" \"/verify\" \"/settle\" \"/status\" \"/SKILL.md\"})"
    action      = "skip"

    action_parameters {
      ruleset  = "current"                                        # skip remaining custom rules (incl. a managed_challenge rule below)
      phases   = ["http_request_sbfm", "http_request_firewall_managed"]  # Super Bot Fight Mode + managed rules
      products = ["bic", "securityLevel"]                         # Browser Integrity Check + Security Level
    }

    logging { enabled = true }
  }
}
```

> One ruleset per phase per zone: if you already manage a
> `http_request_firewall_custom` ruleset, add this as the **first** `rules {}`
> block rather than creating a second resource.

## Step 4 — Verify

```bash
for p in /health /supported /verify /settle; do
  printf "%-12s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' -A 'cardano402-probe' https://cardano402.com$p)"
done
# Expect non-403 (200/400/405 from the origin), NOT a cf-mitigated challenge.
```

Or dispatch the protocol-monitor workflow (in PR #88) against prod — it asserts
exactly this and reports `cf-mitigated: challenge` if still blocked. Once it
passes, the monitor's hourly `schedule:` can be re-enabled.

## Step 5 — Compensating controls (because the challenge is being removed)

Removing the bot challenge from money endpoints widens the attack surface.
Replace the blunt "is this a browser?" gate with controls that work for machine
traffic:

- **Rate limiting** on `/verify` + `/settle` (per-IP, e.g. N/min) — a Cloudflare
  Rate Limiting rule scoped to those paths.
- **Request body-size limits** (Cloudflare + the app's Fastify `bodyLimit`).
- **Keep WAF managed rules ON** for real attack patterns (SQLi, etc.) — do not
  blanket-skip the `waf` product; only skip the challenge that blocks agents.
- **Leave human-facing pages challenged** — this rule excepts only the listed API paths.
- App-side: `/verify` + `/settle` already validate payloads strictly; ensure the
  new payment-outcome metrics meter abuse.

## Caveats

- **Free plan:** Bot Fight Mode (Free) **cannot** be excepted per-path. If Step 1
  shows it as the source, either disable it zone-wide or upgrade to Pro (Super
  Bot Fight Mode supports per-path skips). This may be a plan decision.
- **Path list:** `/status` and `/SKILL.md` are included alongside the four
  confirmed-blocked paths. Add any other machine paths you expose (e.g.
  `/upload`, `/files/:cid` on the resource-server side) if agents must reach them.

## References

- Diagnosis: live probe 2026-05-25 (`cf-mitigated: challenge` on the 5 paths above).
- Related: `docs/security-review-2026-05-25.md`, the protocol-monitor workflow (PR #88).

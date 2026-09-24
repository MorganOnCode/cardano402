# Portfolio cutover: VPS to static assets + optional Preview demo

This supersedes the earlier plan to operate a mainnet facilitator on Workers.
Both future environments use **Cardano Preview**. The existing VPS still serves
mainnet; changing its domain before handling dependants would break payments.

1. Complete the deployment and benchmark checklist in `portfolio-costs.md`.
   The original static landing page may run with both live-demo flags disabled.
2. Resolve agent-to-agent's live `http://facilitator:3000` dependency first:
   remove its paid flow or select a maintained mainnet facilitator. Its
   existing draft v2 PR alone does NOT solve this: it expects a mainnet service
   at cardano402.com. Do not merge it unchanged into this testnet-only plan.
3. Confirm all public API consumers have a replacement or retirement notice.
4. Configure GitHub secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   deployment variable `CLOUDFLARE_DEPLOY_ENABLED=true`, URLs, and the protected
   `production` environment. Add `Testnet demo Worker` to required CI checks.
5. Deploy through `.github/workflows/deploy.yml`. The private demo service has
   no routes; the public Worker serves the original static landing page and optionally
   forwards `/demo/run`. Allow machine API traffic through Cloudflare WAF only
   for the routes deliberately retained; do not remove the rate limits.
6. At the agreed cutover, add the custom domains to the public Worker's
   production config and remove only Cardano402's tunnel ingress entries.
   The existing tunnel is shared with other apps; do not delete the tunnel.
7. Verify the original page design in both modes and on mobile, and (if enabled) one real
   Preview self-payment with an explorer link. No visitor wallet is required.
8. Stop the old Cardano402 container only after the dependency switch is
   verified. Preserve the Redis volume and signing backups for rollback.
9. After a 14-day soak, account for/sweep the old wallets and remove obsolete
   containers, images, volumes, backup jobs and checkout. The old backup job
   also covers shared tunnel configuration; arrange replacement coverage first.

Rollback: restore Cardano402's tunnel ingress and restart the v1 container,
then remove its Worker routes. Keep the shared tunnel and other apps intact.
No cutover, mainnet spending, wallet sweep, or VPS removal is performed by the
portfolio code changes.

// Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
interface CloudflareBindings {
  BLOCKFROST_PROJECT_ID?: string;
}

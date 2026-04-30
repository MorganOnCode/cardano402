# cardano402 packages (workspace scaffolding)

This directory is reserved for the multi-package SDK family laid out in
[`cardano402-upgrade-plan.md`](../cardano402-upgrade-plan.md):

| Package                 | Purpose                                          | Status        |
|-------------------------|--------------------------------------------------|---------------|
| `@cardano402/core`      | Framework-agnostic verify/settle/discovery types | Scaffolded    |
| `@cardano402/express`   | Express middleware                               | Scaffolded    |
| `@cardano402/fastify`   | Fastify plugin (existing in src/sdk)             | Scaffolded    |
| `@cardano402/hono`      | Hono middleware                                  | Scaffolded    |
| `@cardano402/next`      | Next.js middleware (App Router)                  | Scaffolded    |
| `@cardano402/fetch`     | Fetch client wrapper                             | Scaffolded    |
| `@cardano402/axios`     | Axios interceptor                                | Scaffolded    |
| `@cardano402/mcp-server`| MCP server (stdio + HTTP streaming)              | Scaffolded    |

Each scaffold ships:

- `package.json` with the published name and a `main` pointing at a stub
- `src/index.ts` exporting a `notImplemented` symbol with a clear TODO
- A short `README.md` describing the intended surface

Implementations land sprint by sprint; the scaffolding makes the public
package names reservable and the contract for contributors visible.

To turn the repo into a real monorepo, add a `pnpm-workspace.yaml`:

```yaml
packages:
  - .
  - packages/*
```

Then `pnpm install` populates `node_modules` for each package.

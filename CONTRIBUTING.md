# Contributing to x402 Cardano Facilitator

Thanks for your interest in contributing. This guide covers development setup, coding standards, and the PR process.

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm 10.8+
- Docker and Docker Compose

### Getting Started

1. Fork and clone the repository
2. `pnpm install`
3. `pnpm docker:up` (starts Redis)
4. `cp config/config.example.json config/config.json` (configure Blockfrost + seed phrase)
5. `pnpm dev` (start dev server)

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server with hot reload |
| `pnpm build` | Build with tsup |
| `pnpm test` | Run all tests |
| `pnpm test:coverage` | Run tests with coverage |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | TypeScript type checking |

## Coding Standards

- **TypeScript strict mode** -- no `any` unless unavoidable
- **ESM-only** -- use `.js` extensions in imports
- **Zod validation** on all external inputs
- **Semicolons enabled** (Airbnb style)
- Pre-commit hooks run lint-staged, typecheck, and a `gitleaks protect --staged`
  secret scan if `gitleaks` is on your PATH

### Local gitleaks (recommended)

The pre-commit hook runs `gitleaks protect --staged` to catch accidental
secret commits before they leave your machine. CI runs the same check on
push, so a missing local install is non-fatal — but installing it locally
saves you from a force-push-with-history-rewrite if you ever slip.

```bash
# macOS
brew install gitleaks

# Linux (binary release)
curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz | tar xz -C /usr/local/bin gitleaks

# Docker fallback (alias in your shell profile)
alias gitleaks='docker run --rm -v $(pwd):/repo zricethezav/gitleaks:v8.21.2'
```

## Testing

All changes must include tests. The project uses Vitest with coverage thresholds enforced at 80% statements, 65% branches, 75% functions, and 80% lines.

```bash
# Run tests
pnpm test

# Run with coverage report
pnpm test:coverage
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with tests
3. Ensure `pnpm test`, `pnpm lint`, and `pnpm typecheck` all pass
4. Submit a PR with a clear description of changes
5. CI must pass before merge

## Commit Messages

Follow conventional commit format:

```
type(scope): concise description

- detail 1
- detail 2
```

Types: `feat`, `fix`, `test`, `refactor`, `chore`, `docs`

## Security

If you discover a security vulnerability, do NOT open a public issue. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## Code of Conduct

Be respectful. Focus on constructive feedback. We're all here to build.

# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in cardano402, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. [Create a GitHub security advisory](https://github.com/MorganOnCode/cardano402/security/advisories/new) (preferred)
2. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 5 business days
- **Fix timeline:** Depends on severity

### Disclosure Policy

We follow coordinated disclosure:

1. Confirm the vulnerability
2. Develop and test a fix
3. Release the fix
4. Credit the reporter (unless they prefer anonymity)
5. Publicly disclose after the fix is available

## Scope

This policy covers the cardano402 repository and its published npm packages.

## Known Security Properties

- Blockfrost API keys are never logged or exposed in error responses
- All inputs validated with Zod schemas
- Rate limiting on all public endpoints (configurable per-route)
- Request body size limits (50KB default, 10MB for uploads)
- Production Docker image runs as non-root user
- Redis authentication supported and recommended for production
- Transaction deduplication prevents double-settlement (SHA-256 + Redis SET NX)
- 10-step verification pipeline catches malformed, expired, and invalid transactions

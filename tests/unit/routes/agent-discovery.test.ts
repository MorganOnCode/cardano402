import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { agentDiscoveryRoutesPlugin } from '../../../src/routes/agent-discovery.js';

async function createServer(): Promise<FastifyInstance> {
  const server = fastify({ logger: false });
  await server.register(agentDiscoveryRoutesPlugin);
  await server.ready();
  return server;
}

describe('Agent-discovery routes', () => {
  let server: FastifyInstance;
  let originalCwd: string;
  let tmpDir: string;

  beforeAll(() => {
    // The /SKILL.md route reads `${process.cwd()}/SKILL.md`. Point cwd at
    // a temp dir with a known fixture so tests are hermetic.
    originalCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'cardano402-skill-'));
    writeFileSync(join(tmpDir, 'SKILL.md'), '# Test SKILL\n\nFixture body.\n');
    process.chdir(tmpDir);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  describe('GET /robots.txt', () => {
    it('returns 200 with text/plain content', async () => {
      server = await createServer();
      const res = await server.inject({ method: 'GET', url: '/robots.txt' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
    });

    it('disallows the payment-gated endpoints', async () => {
      server = await createServer();
      const res = await server.inject({ method: 'GET', url: '/robots.txt' });
      expect(res.body).toMatch(/Disallow: \/verify/);
      expect(res.body).toMatch(/Disallow: \/settle/);
      expect(res.body).toMatch(/Disallow: \/upload/);
    });

    it('references the sitemap', async () => {
      server = await createServer();
      const res = await server.inject({ method: 'GET', url: '/robots.txt' });
      expect(res.body).toMatch(/Sitemap: \/sitemap\.xml/);
    });
  });

  describe('GET /agents.txt', () => {
    it('returns 200 with text/plain content', async () => {
      server = await createServer();
      const res = await server.inject({ method: 'GET', url: '/agents.txt' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
    });

    it('references the SKILL.md and well-known manifests', async () => {
      server = await createServer();
      const res = await server.inject({ method: 'GET', url: '/agents.txt' });
      expect(res.body).toMatch(/Skill: \/SKILL\.md/);
      expect(res.body).toMatch(/X402-Manifest:\s+\/\.well-known\/x402\.json/);
      expect(res.body).toMatch(/Agent-Card:\s+\/\.well-known\/agent-card\.json/);
      expect(res.body).toMatch(/MCP-Server-Card:\s+\/\.well-known\/mcp\/server-card\.json/);
    });

    it('marks the payment-gated endpoints as pay-before-call', async () => {
      server = await createServer();
      const res = await server.inject({ method: 'GET', url: '/agents.txt' });
      expect(res.body).toMatch(/Pay-Before-Call: \/verify/);
      expect(res.body).toMatch(/Pay-Before-Call: \/settle/);
      expect(res.body).toMatch(/Pay-Before-Call: \/upload/);
    });
  });

  describe('GET /sitemap.xml', () => {
    it('returns 200 with XML content', async () => {
      server = await createServer();
      const res = await server.inject({ method: 'GET', url: '/sitemap.xml' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/xml');
    });

    it('includes the agent-discovery endpoints', async () => {
      server = await createServer();
      const res = await server.inject({ method: 'GET', url: '/sitemap.xml' });
      expect(res.body).toMatch(/<loc>\/SKILL\.md<\/loc>/);
      expect(res.body).toMatch(/<loc>\/agents\.txt<\/loc>/);
      expect(res.body).toMatch(/<loc>\/\.well-known\/x402\.json<\/loc>/);
    });

    it('starts with the XML prolog', async () => {
      server = await createServer();
      const res = await server.inject({ method: 'GET', url: '/sitemap.xml' });
      expect(res.body).toMatch(/^<\?xml version="1\.0"/);
    });
  });

  describe('GET /SKILL.md', () => {
    it('returns 200 with text/markdown content', async () => {
      server = await createServer();
      const res = await server.inject({ method: 'GET', url: '/SKILL.md' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
    });

    it('serves the SKILL.md file from the working directory', async () => {
      server = await createServer();
      const res = await server.inject({ method: 'GET', url: '/SKILL.md' });
      expect(res.body).toContain('# Test SKILL');
      expect(res.body).toContain('Fixture body.');
    });
  });
});

// Agent-discovery surface: /robots.txt, /agents.txt, /sitemap.xml, /SKILL.md.
//
// Complements the JSON manifests served by well-known.ts. AI agents that
// don't yet speak /.well-known/x402.json can find their bearings via the
// text-shaped surface here, then follow the links to the structured ones.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

const ROBOTS_TXT = `# robots.txt -- crawler policy
# Agent-specific guidance lives at /agents.txt and /SKILL.md.

User-agent: *
Allow: /
Allow: /.well-known/
Allow: /SKILL.md
Allow: /agents.txt
Disallow: /verify
Disallow: /settle
Disallow: /upload
Disallow: /files/
Disallow: /metrics

Sitemap: /sitemap.xml
`;

const AGENTS_TXT = `# agents.txt -- guidance for AI agents (companion to robots.txt)
#
# This server is cardano402, an x402 payment facilitator for Cardano.
# Agents can pay-per-call for paid HTTP endpoints using ADA.
#
# Repository: https://github.com/MorganOnCode/cardano402
# Spec:       https://github.com/x402-foundation/x402

# Machine-readable skill file (read this first)
Skill: /SKILL.md

# Machine-readable discovery surface
X402-Manifest:   /.well-known/x402.json
Agent-Card:      /.well-known/agent-card.json
AI-Agent:        /.well-known/ai-agent.json
MCP-Server-Card: /.well-known/mcp/server-card.json
OpenAPI:         /docs

# Crawl policy
User-agent: *
Allow: /
Allow: /.well-known/
Allow: /SKILL.md
Allow: /agents.txt
Allow: /docs

# Pay-before-call: these endpoints expect an x402 PAYMENT-SIGNATURE header.
# Calling without one will receive a 402 Payment Required response whose
# Payment-Required header describes the price and payTo address.
Pay-Before-Call: /verify
Pay-Before-Call: /settle
Pay-Before-Call: /upload

Sitemap: /sitemap.xml
`;

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>/</loc><priority>1.0</priority></url>
  <url><loc>/docs</loc><priority>0.8</priority></url>
  <url><loc>/SKILL.md</loc><priority>0.9</priority></url>
  <url><loc>/agents.txt</loc><priority>0.9</priority></url>
  <url><loc>/.well-known/x402.json</loc><priority>0.9</priority></url>
  <url><loc>/.well-known/agent-card.json</loc><priority>0.7</priority></url>
  <url><loc>/.well-known/ai-agent.json</loc><priority>0.7</priority></url>
  <url><loc>/.well-known/mcp/server-card.json</loc><priority>0.7</priority></url>
</urlset>
`;

let cachedSkillMd: string | null = null;

async function readSkillMd(): Promise<string> {
  if (cachedSkillMd === null) {
    cachedSkillMd = await readFile(resolve(process.cwd(), 'SKILL.md'), 'utf-8');
  }
  return cachedSkillMd;
}

const agentDiscoveryRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get('/robots.txt', async (_req, reply) => {
    return reply.type('text/plain; charset=utf-8').status(200).send(ROBOTS_TXT);
  });

  fastify.get('/agents.txt', async (_req, reply) => {
    return reply.type('text/plain; charset=utf-8').status(200).send(AGENTS_TXT);
  });

  fastify.get('/sitemap.xml', async (_req, reply) => {
    return reply.type('application/xml; charset=utf-8').status(200).send(SITEMAP_XML);
  });

  fastify.get('/SKILL.md', async (_req, reply) => {
    const body = await readSkillMd();
    return reply.type('text/markdown; charset=utf-8').status(200).send(body);
  });

  done();
};

export const agentDiscoveryRoutesPlugin = fp(agentDiscoveryRoutes, {
  name: 'agent-discovery-routes',
  fastify: '5.x',
});

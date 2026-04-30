// /.well-known/ discovery routes for agent-native discovery.
//
// Emits four shapes from a single source of truth (ServiceCatalog):
//   - GET /.well-known/x402.json            (x402 native)
//   - GET /.well-known/agent-card.json      (Google A2A)
//   - GET /.well-known/ai-agent.json        (aiia.ro ai-agent.json)
//   - GET /.well-known/mcp/server-card.json (SEP-1649 MCP discovery)
//
// Why several formats? There is no single winner among agent discovery
// standards yet. Emitting all of them costs nothing and means whichever
// crawler / agent finds the server, it sees the catalogue.

import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

const wellKnownRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get('/.well-known/x402.json', async (_req, reply) => {
    return reply.status(200).send(fastify.catalog.toX402Json());
  });

  fastify.get('/.well-known/agent-card.json', async (_req, reply) => {
    return reply.status(200).send(fastify.catalog.toAgentCardJson());
  });

  fastify.get('/.well-known/ai-agent.json', async (_req, reply) => {
    return reply.status(200).send(fastify.catalog.toAiAgentJson());
  });

  fastify.get('/.well-known/mcp/server-card.json', async (_req, reply) => {
    return reply.status(200).send(fastify.catalog.toMcpServerCardJson());
  });

  done();
};

export const wellKnownRoutesPlugin = fp(wellKnownRoutes, {
  name: 'well-known-routes',
  fastify: '5.x',
});

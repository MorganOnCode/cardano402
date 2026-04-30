// Service catalog: a single source of truth for paid endpoints exposed by
// this server. Each paid route registers itself here at startup; the
// /.well-known/ discovery endpoints emit the catalog in several agent-
// readable shapes (x402.json, agent-card.json, ai-agent.json,
// mcp/server-card.json).
//
// The aim is "registry-free discovery": any agent crawling the server can
// find the catalog without prior arrangement, and no central party gates
// inclusion.

export interface PaidEndpoint {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Server-relative path (e.g. "/api/analyze") */
  path: string;
  /** Payment scheme (currently always "exact") */
  scheme: 'exact';
  /** CAIP-2 chain identifier (e.g. "cardano:mainnet") */
  network: string;
  /** Smallest-unit amount as a decimal string */
  amount: string;
  /** Asset id: "lovelace" or "policyId.assetNameHex" */
  asset: string;
  /** Bech32 recipient address */
  payTo: string;
  /** Per-spec recommended ~600s for Cardano */
  maxTimeoutSeconds: number;
  /** Human-readable description */
  description?: string;
  /** JSON Schema reference describing the request body */
  inputSchema?: Record<string, unknown>;
  /** JSON Schema reference describing the response body */
  outputSchema?: Record<string, unknown>;
}

export interface ServerInfo {
  name: string;
  description?: string;
  contact?: string;
  /** Public base URL for this server (used in agent-card.json) */
  url?: string;
}

export interface FacilitatorInfo {
  /** Public URL of the facilitator backing these paid endpoints. */
  url?: string;
}

export class ServiceCatalog {
  private readonly endpoints: PaidEndpoint[] = [];
  private serverInfo: ServerInfo = { name: 'cardano402 server' };
  private facilitator: FacilitatorInfo = {};

  setServer(info: ServerInfo): this {
    this.serverInfo = info;
    return this;
  }

  setFacilitator(info: FacilitatorInfo): this {
    this.facilitator = info;
    return this;
  }

  registerPaidRoute(endpoint: PaidEndpoint): this {
    this.endpoints.push(endpoint);
    return this;
  }

  list(): readonly PaidEndpoint[] {
    return this.endpoints;
  }

  server(): Readonly<ServerInfo> {
    return this.serverInfo;
  }

  facilitatorInfo(): Readonly<FacilitatorInfo> {
    return this.facilitator;
  }

  // -------------------------------------------------------------------------
  // Renderers for the four /.well-known/ shapes
  // -------------------------------------------------------------------------

  /**
   * cardano402-native shape: emits x402 protocol version, server metadata,
   * the full endpoint list, and the backing facilitator URL.
   */
  toX402Json(): Record<string, unknown> {
    return {
      x402Version: 2,
      server: this.serverInfo,
      endpoints: this.endpoints,
      facilitator: this.facilitator.url,
    };
  }

  /**
   * Google A2A protocol agent-card shape. Minimal subset; consumers expect
   * `name`, `description`, `url`, and a list of capabilities.
   */
  toAgentCardJson(): Record<string, unknown> {
    return {
      protocol: 'a2a/0.1',
      name: this.serverInfo.name,
      description: this.serverInfo.description,
      url: this.serverInfo.url,
      contact: this.serverInfo.contact,
      capabilities: this.endpoints.map((e) => ({
        type: 'http',
        method: e.method,
        path: e.path,
        description: e.description,
        pricing: {
          amount: e.amount,
          asset: e.asset,
          network: e.network,
        },
      })),
    };
  }

  /**
   * aiia.ro ai-agent.json shape. Lightweight agent identity manifest.
   */
  toAiAgentJson(): Record<string, unknown> {
    return {
      schemaVersion: '0.1',
      name: this.serverInfo.name,
      description: this.serverInfo.description,
      contact: this.serverInfo.contact,
      paymentMethods: [
        {
          protocol: 'x402',
          version: '2',
          chains: Array.from(new Set(this.endpoints.map((e) => e.network))),
        },
      ],
      services: this.endpoints.map((e) => ({
        method: e.method,
        path: e.path,
        description: e.description,
        amount: e.amount,
        asset: e.asset,
        network: e.network,
      })),
    };
  }

  /**
   * MCP server-card shape (SEP-1649). Allows MCP clients to discover this
   * server at `/.well-known/mcp/server-card.json`.
   */
  toMcpServerCardJson(): Record<string, unknown> {
    return {
      schemaVersion: '0.1',
      name: this.serverInfo.name,
      description: this.serverInfo.description,
      transport: ['http+streaming'],
      url: this.serverInfo.url,
      tools: this.endpoints.map((e) => ({
        name: `${e.method.toLowerCase()}_${e.path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
        description: e.description ?? `${e.method} ${e.path}`,
        priced: true,
        price: {
          amount: e.amount,
          asset: e.asset,
          network: e.network,
        },
        method: e.method,
        path: e.path,
        inputSchema: e.inputSchema,
        outputSchema: e.outputSchema,
      })),
    };
  }
}

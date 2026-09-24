# Architecture

This document describes the x402 Cardano Payment Facilitator's architecture through four diagrams: how components relate, how payments flow, how the facilitator is structured internally, and how transaction data moves through the verification and settlement pipeline.

For operational procedures, see [operations.md](./operations.md).

---

## 1. Component Diagram

The x402 protocol involves four actors: the **Client** (a wallet that builds and signs Cardano transactions), the **Resource Server** (serves content behind a paywall), the **Facilitator** (verifies and settles payments), and the **Cardano blockchain** (accessed via Blockfrost).

The Resource Server embeds the SDK, which provides a payment gate middleware, a facilitator client for API calls, and a 402 response builder.

```mermaid
graph TD
    Client["Client<br/>(Wallet + Lucid Evolution)"]
    ResourceServer["Resource Server"]
    Facilitator["Facilitator"]
    Cardano["Cardano Blockchain<br/>(via Blockfrost)"]

    Client <-->|"HTTP requests<br/>402 responses<br/>Payment-Signature header"| ResourceServer
    Client -->|"Build tx, query UTXOs"| Cardano

    subgraph SDK ["SDK (embedded in Resource Server)"]
        PaymentGate["Payment Gate<br/>Middleware"]
        FacClient["FacilitatorClient"]
        Reply402["402 Response<br/>Builder"]
    end

    ResourceServer --> PaymentGate
    PaymentGate --> FacClient
    PaymentGate --> Reply402
    FacClient -->|"POST /verify<br/>POST /settle"| Facilitator
    Facilitator -->|"Submit tx<br/>Query UTXOs<br/>Get slots"| Cardano

    style Client fill:#e1f5fe,stroke:#0288d1
    style ResourceServer fill:#f3e5f5,stroke:#7b1fa2
    style Facilitator fill:#e8f5e9,stroke:#388e3c
    style Cardano fill:#fff3e0,stroke:#f57c00
    style SDK fill:#fce4ec,stroke:#c62828
```

**Key relationships:**

- The Client never talks to the Facilitator directly. All communication is mediated by the Resource Server.
- The SDK's `FacilitatorClient` makes HTTP calls to the Facilitator's `/verify` and `/settle` endpoints.
- Both the Client and the Facilitator interact with the Cardano blockchain -- the Client to build transactions, the Facilitator to submit and query them.

---

## 2. Payment Flow

The full x402 payment cycle follows a challenge-response pattern. The Resource Server returns HTTP 402 with payment requirements, the Client builds and signs a Cardano transaction, and the Facilitator verifies and settles it on-chain.

```mermaid
sequenceDiagram
    participant C as Client
    participant RS as Resource Server
    participant F as Facilitator
    participant BC as Cardano<br/>(Blockfrost)

    C->>RS: POST /upload (no payment)
    RS-->>C: 402 Payment Required<br/>(Payment-Required header)

    Note over C: Parse requirements<br/>Build Cardano tx via Lucid<br/>Sign transaction

    C->>RS: POST /upload<br/>(Payment-Signature header)

    Note over RS: Payment gate intercepts

    RS->>F: POST /verify<br/>(CBOR tx + requirements)

    Note over F: Run 10-check<br/>verification pipeline

    F-->>RS: isValid: true

    RS->>F: POST /settle<br/>(CBOR tx + requirements)

    F->>BC: Submit signed CBOR tx
    BC-->>F: Transaction accepted

    Note over F: Poll for confirmation<br/>(5s interval, 120s timeout)

    F->>BC: Query transaction status
    BC-->>F: Confirmed on-chain

    F-->>RS: success: true, txHash

    Note over RS: Execute business logic<br/>(store file via StorageBackend)

    RS-->>C: 200 OK + result<br/>(X-Payment-Response header)
```

**Key points:**

- The Client builds and signs the full Cardano transaction. The Facilitator never holds private keys.
- Verification and settlement are separate steps. The Resource Server can verify a payment without settling it (useful for pre-flight checks).
- UTXO-based replay protection is inherent -- each UTXO can only be spent once, so the same transaction cannot be submitted twice.
- Settlement is idempotent: a SHA-256 dedup key prevents double-submission even if the Resource Server retries.

---

## 3. Internal Architecture

The Facilitator is a Fastify application organized into five layers: HTTP, Verification, Settlement, Chain, and Storage. External dependencies are Redis (caching + dedup) and Blockfrost (Cardano API).

```mermaid
graph TD
    subgraph HTTP["HTTP Layer"]
        Fastify["Fastify Server"]
        Middleware["Helmet + CORS + Rate Limit"]
        Routes["/health /supported<br/>/verify /settle /status<br/>/upload /files/:cid"]
    end

    subgraph Verification["Verification Pipeline"]
        CBOR["CBOR Deserializer<br/>(CML)"]
        Checks["10 Verification Checks"]
        TokenReg["Token Registry"]
    end

    subgraph Settlement["Settlement Pipeline"]
        Reverify["Re-verify"]
        Dedup["SHA-256 Dedup<br/>(Redis SET NX)"]
        Submit["Blockfrost Submit"]
        Poll["Poll Confirmation"]
    end

    subgraph Chain["Chain Layer"]
        Provider["ChainProvider"]
        BFClient["BlockfrostClient<br/>(Retry + Backoff)"]
        Cache["UTXO Cache<br/>(L1 Map + L2 Redis)"]
        Lucid["Lucid Evolution"]
    end

    subgraph Storage["Storage Layer"]
        Interface["StorageBackend"]
        FsBack["FsBackend<br/>(SHA-256 CID)"]
        IpfsBack["IpfsBackend<br/>(Kubo HTTP)"]
    end

    Redis[("Redis")]
    Blockfrost["Blockfrost API"]

    Fastify --> Middleware --> Routes
    Routes --> CBOR
    CBOR --> Checks
    Checks --> TokenReg
    Routes --> Reverify
    Reverify --> Checks
    Reverify --> Dedup
    Dedup --> Submit
    Submit --> Poll
    Routes --> Provider
    Provider --> BFClient
    Provider --> Cache
    Provider --> Lucid
    BFClient --> Blockfrost
    Cache --> Redis
    Dedup --> Redis
    Submit --> Blockfrost
    Poll --> Blockfrost
    Interface --> FsBack
    Interface --> IpfsBack
    Routes --> Interface

    style HTTP fill:#e3f2fd,stroke:#1565c0
    style Verification fill:#f1f8e9,stroke:#558b2f
    style Settlement fill:#fff8e1,stroke:#f9a825
    style Chain fill:#fce4ec,stroke:#c62828
    style Storage fill:#f3e5f5,stroke:#7b1fa2
    style Redis fill:#ffebee,stroke:#b71c1c
    style Blockfrost fill:#fff3e0,stroke:#e65100
```

**Module responsibilities:**

- **HTTP Layer**: Request parsing, Zod validation, security headers, rate limiting, response formatting. Seven route plugins registered on the Fastify server.
- **Verification Pipeline**: Decodes base64 CBOR, deserializes via CML (Cardano Multiplatform Library), runs 10 ordered checks: CBOR validity, scheme, network, token support, recipient address, amount, min UTXO, witness signature, TTL, and fee.
- **Settlement Pipeline**: Re-verifies the transaction (catches stale submissions), computes a SHA-256 dedup key (Redis SET NX with 24h TTL), submits raw CBOR to Blockfrost, polls for on-chain confirmation at 5-second intervals with a 120-second timeout.
- **Chain Layer**: `ChainProvider` orchestrates Blockfrost queries (with retry and exponential backoff), a two-layer UTXO cache (in-memory L1 Map with LRU eviction, Redis L2 with TTL), UTXO reservation (Map + Redis, 120s TTL, crash recovery), and Lucid Evolution for Cardano primitives.
- **Storage Layer**: `StorageBackend` interface with two implementations -- `FsBackend` (local filesystem, SHA-256 content addressing) and `IpfsBackend` (Kubo HTTP API).

---

## 4. Data Flow

This diagram shows how a transaction moves through the verification and settlement pipeline, from base64 input to on-chain confirmation.

```mermaid
flowchart LR
    Input["Base64 CBOR<br/>Input"]
    Decode["Decode<br/>Base64"]
    Deser["Deserialize<br/>CBOR (CML)"]

    subgraph Verify["Verification Checks (10)"]
        direction TB
        C1["1. CBOR Valid"]
        C2["2. Scheme (exact)"]
        C3["3. Network (CAIP-2)"]
        C4["4. Token Supported"]
        C5["5. Recipient Address"]
        C6["6. Amount (>= required)"]
        C7["7. Min UTXO"]
        C8["8. Witness Signature"]
        C9["9. TTL Bounds"]
        C10["10. Fee Bounds"]
        C1 --> C2 --> C3 --> C4 --> C5 --> C6 --> C7 --> C8 --> C9 --> C10
    end

    Pass{"All<br/>Passed?"}

    subgraph Settle["Settlement"]
        direction TB
        DedupKey["Compute SHA-256<br/>Dedup Key"]
        RedisNX["Redis SET NX<br/>(24h TTL)"]
        SubmitTx["Submit CBOR to<br/>Blockfrost"]
        PollTx["Poll Transaction<br/>(5s / 120s)"]
        DedupKey --> RedisNX --> SubmitTx --> PollTx
    end

    Confirmed["Confirmed<br/>On-Chain"]
    Rejected["Rejected<br/>(with reasons)"]

    Input --> Decode --> Deser --> Verify
    Verify --> Pass
    Pass -->|"Yes"| Settle
    Pass -->|"No"| Rejected
    Settle --> Confirmed

    style Input fill:#e3f2fd,stroke:#1565c0
    style Verify fill:#f1f8e9,stroke:#558b2f
    style Settle fill:#fff8e1,stroke:#f9a825
    style Confirmed fill:#e8f5e9,stroke:#2e7d32
    style Rejected fill:#ffebee,stroke:#c62828
```

**Data transformation at each stage:**

1. **Input**: Base64-encoded string from the `Payment-Signature` header.
2. **Decode**: Raw CBOR bytes (Uint8Array).
3. **Deserialize**: Structured transaction object with body (inputs, outputs, fee, TTL), witnesses (vkey signatures), and metadata.
4. **Verification**: Each check examines one aspect -- scheme matching, network ID comparison (CAIP-2), token registry lookup, recipient address hex comparison, amount comparison (supports overpayment), min UTXO protocol check, witness presence, TTL window validation, fee bounds check. Pipeline uses a collect-all-errors pattern (all checks run even if earlier ones fail).
5. **Settlement**: SHA-256 hash of the CBOR bytes serves as a dedup key. Redis `SET NX` ensures idempotent submission. Blockfrost `/tx/submit` accepts raw CBOR. Polling queries `/txs/{hash}` until confirmed or timeout.

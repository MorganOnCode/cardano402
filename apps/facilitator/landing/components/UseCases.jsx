// UseCases.jsx — show what's possible

const CASES = [
  {
    color: 'var(--peach)',
    icon: '🤖',
    tag: 'agents',
    title: 'AI agents that pay their own way',
    body: 'Let your Claude or GPT agent call paid APIs without you handing over a credit card. The agent has a wallet. The wallet pays per request.',
    code: 'curl -X POST $API/run\n# 402 → wallet signs → 200',
  },
  {
    color: 'var(--mint)',
    icon: '📡',
    tag: 'apis',
    title: 'Monetize an API in 12 lines',
    body: "Wrap any Fastify route in createPaymentGate(). No accounts, no Stripe webhooks, no monthly minimums. Set your price, ship.",
    code: "app.post('/api/x',\n  { preHandler: gate },\n  handler);",
  },
  {
    color: 'var(--lilac)',
    icon: '📁',
    tag: 'storage',
    title: 'Pay-to-pin file storage',
    body: 'The reference implementation: upload a file with a payment, get a content ID back. Downloads are free. Storage costs are real.',
    code: 'POST /upload  →  ₳ 2.00\nGET  /files/:cid  →  free',
  },
  {
    color: 'var(--lemon)',
    icon: '⚡',
    tag: 'compute',
    title: 'Per-second compute',
    body: 'GPU inference, video encoding, code execution. Charge by the second of work, not the seat. Settles before the response leaves your server.',
    code: 'rate: ₳ 0.05/sec\nbilled: 4.2s = ₳ 0.21',
  },
  {
    color: 'var(--pink)',
    icon: '🎟️',
    tag: 'access',
    title: 'Tickets without the platform',
    body: 'A 402 unlocks a one-time URL. No Eventbrite, no scalpers, no platform cut. The wallet that paid is the wallet that can re-fetch.',
    code: 'GET /event/replay\n402 → ₳ 5 → 200 (signed url)',
  },
  {
    color: 'white',
    icon: '🧩',
    tag: 'mcp',
    title: 'Paid MCP tools',
    body: 'Expose a paid Model Context Protocol tool. Agents discover it, invoke it, pay for it — and the wallet trail is the receipt.',
    code: 'tool: web_search.deep\nprice: ₳ 0.5/query',
  },
];

function UseCases({ layout = 'cards' }) {
  const isMobile = (window.useIsMobile || (() => false))();
  return (
    <section id="cases" style={{
      paddingTop: isMobile ? 60 : 100,
      paddingBottom: isMobile ? 60 : 100,
      position: 'relative',
    }}>
      <div className="wrap">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 24, marginBottom: 50 }}>
          <div style={{ maxWidth: 680 }}>
            <span className="eyebrow">§ use cases</span>
            <h2 className="section-title">
              What can you actually <span style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', color: 'var(--blue)' }}>build</span> with this?
            </h2>
          </div>
          <p style={{ fontSize: 16, opacity: 0.7, maxWidth: 380, margin: 0 }}>
            All of these run on the same primitive: a server that says 402, a client that pays, a chain that settles.
          </p>
        </div>

        {layout === 'cards' && <CardsLayout />}
        {layout === 'grid' && <GridLayout />}
        {layout === 'rolodex' && <RolodexLayout isMobile={isMobile} />}
      </div>
    </section>
  );
}

function CardsLayout() {
  return (
    <div style={{
      display: 'grid', gap: 18,
      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    }}>
      {CASES.map((c, i) => (
        <article key={i} style={{
          background: c.color,
          border: '2px solid var(--ink)',
          borderRadius: 22,
          padding: 26,
          display: 'flex', flexDirection: 'column',
          transition: 'transform .2s ease',
        }}
        onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-4px) rotate(-0.5deg)'}
        onMouseLeave={(e) => e.currentTarget.style.transform = 'none'}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 32 }}>{c.icon}</span>
            <span className="mono" style={{ fontSize: 11, background: 'var(--ink)', color: 'white', padding: '3px 8px', borderRadius: 6, fontWeight: 700, letterSpacing: '0.06em' }}>{c.tag.toUpperCase()}</span>
          </div>
          <h3 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{c.title}</h3>
          <p style={{ margin: '0 0 18px', fontSize: 15, lineHeight: 1.5, opacity: 0.85 }}>{c.body}</p>
          <pre style={{
            margin: 'auto 0 0', padding: '10px 12px',
            background: 'rgba(10, 16, 36, 0.85)', color: 'var(--paper)',
            borderRadius: 10, fontSize: 11.5, lineHeight: 1.5,
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'pre-wrap',
          }}>{c.code}</pre>
        </article>
      ))}
    </div>
  );
}

function GridLayout() {
  return (
    <div style={{
      border: '2px solid var(--ink)',
      borderRadius: 22, overflow: 'hidden',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      background: 'var(--ink)', gap: 2,
    }}>
      {CASES.map((c, i) => (
        <div key={i} style={{ background: 'var(--paper)', padding: 28 }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>{c.icon}</div>
          <div className="mono" style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>{c.tag}</div>
          <h3 style={{ margin: '0 0 10px', fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>{c.title}</h3>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, opacity: 0.75 }}>{c.body}</p>
        </div>
      ))}
    </div>
  );
}

function RolodexLayout({ isMobile }) {
  const [active, setActive] = React.useState(0);

  // Mobile: stack tabs above the content panel and let the tab row scroll horizontally
  // if needed. Desktop: keep the original 320px sidebar + content layout.
  const wrapperStyle = isMobile
    ? { display: 'flex', flexDirection: 'column', gap: 18 }
    : { display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24, alignItems: 'flex-start' };

  const tabsStyle = isMobile
    ? {
        display: 'flex', flexDirection: 'row', gap: 8,
        overflowX: 'auto', paddingBottom: 4,
        // Hide scrollbar visually on iOS while keeping horizontal scroll usable.
        WebkitOverflowScrolling: 'touch',
        scrollSnapType: 'x mandatory',
      }
    : { display: 'flex', flexDirection: 'column', gap: 8 };

  const tabBaseStyle = (i) => ({
    textAlign: 'left',
    background: i === active ? CASES[i].color : 'white',
    border: '2px solid var(--ink)',
    borderRadius: 14,
    padding: isMobile ? '10px 14px' : '14px 16px',
    cursor: 'pointer',
    fontFamily: 'inherit', fontWeight: 600,
    transform: !isMobile && i === active ? 'translateX(8px)' : 'none',
    transition: 'transform .15s ease, background .15s ease',
    display: 'flex', alignItems: 'center', gap: 10,
    flex: isMobile ? '0 0 auto' : undefined,
    scrollSnapAlign: isMobile ? 'start' : undefined,
    whiteSpace: isMobile ? 'nowrap' : 'normal',
  });

  return (
    <div style={wrapperStyle}>
      <div style={tabsStyle}>
        {CASES.map((c, i) => (
          <button key={i} onClick={() => setActive(i)} style={tabBaseStyle(i)}>
            <span style={{ fontSize: isMobile ? 18 : 22 }}>{c.icon}</span>
            <span style={{ fontSize: isMobile ? 13.5 : 15 }}>{c.title}</span>
          </button>
        ))}
      </div>
      <div style={{
        background: CASES[active].color,
        border: '2px solid var(--ink)',
        borderRadius: isMobile ? 18 : 22,
        padding: isMobile ? 22 : 36,
        minHeight: isMobile ? 0 : 360,
      }}>
        <div className="mono" style={{ fontSize: 12, marginBottom: 12 }}>// {CASES[active].tag}</div>
        <h3 style={{
          margin: '0 0 14px',
          fontSize: isMobile ? 24 : 32,
          fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15,
        }}>{CASES[active].title}</h3>
        <p style={{
          margin: '0 0 20px',
          fontSize: isMobile ? 15 : 17,
          lineHeight: 1.5, opacity: 0.85, maxWidth: 520,
        }}>{CASES[active].body}</p>
        <pre style={{
          padding: isMobile ? '12px 14px' : '14px 18px',
          background: 'rgba(10, 16, 36, 0.9)', color: 'var(--paper)',
          borderRadius: 12,
          fontSize: isMobile ? 12 : 13,
          lineHeight: 1.6,
          fontFamily: "'JetBrains Mono', monospace",
          whiteSpace: 'pre-wrap',
          display: isMobile ? 'block' : 'inline-block',
          margin: 0,
          overflowX: 'auto',
        }}>{CASES[active].code}</pre>
      </div>
    </div>
  );
}

window.UseCases = UseCases;

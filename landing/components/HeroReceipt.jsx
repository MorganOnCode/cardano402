// HeroReceipt.jsx — paper receipt motif, warm cream

function HeroReceipt({ showStickers }) {
  return (
    <section style={{ paddingTop: 40, paddingBottom: 100, position: 'relative', overflow: 'hidden' }}>
      <div className="wrap" style={{ position: 'relative' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.05fr 0.95fr',
          gap: 60,
          alignItems: 'center',
          minHeight: 620,
        }}>
          <div>
            <div className="pill" style={{ marginBottom: 28 }}>
              <span className="dot"></span>
              <span className="mono" style={{ fontSize: 12 }}>HTTP 402 · Cardano · live on preview</span>
            </div>

            <h1 style={{
              fontSize: 'clamp(56px, 7vw, 96px)',
              lineHeight: 0.95,
              letterSpacing: '-0.035em',
              margin: '0 0 24px',
              fontWeight: 700,
              textWrap: 'balance',
            }}>
              The internet finally has a&nbsp;
              <span style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontStyle: 'italic',
                fontWeight: 400,
                color: 'var(--blue)',
                position: 'relative',
              }}>
                cash register
                <svg style={{ position: 'absolute', left: -8, right: -8, bottom: -14, width: 'calc(100% + 16px)' }} viewBox="0 0 320 18" preserveAspectRatio="none">
                  <path d="M2 12 C 60 4, 160 18, 318 6" stroke="var(--peach)" strokeWidth="5" fill="none" strokeLinecap="round" />
                </svg>
              </span>.
            </h1>

            <p style={{
              fontSize: 20, lineHeight: 1.5, maxWidth: 540,
              opacity: 0.78, margin: '0 0 36px',
            }}>
              <strong style={{ fontWeight: 600, opacity: 1 }}>x402</strong> turns the dusty
              "<span className="mono" style={{ fontSize: 17 }}>402 Payment Required</span>" status code
              into a real payment rail. <strong style={{ fontWeight: 600, opacity: 1 }}>cardano402</strong> is
              the open implementation that settles those payments on Cardano — built so agents,
              APIs and humans can pay per-request without sign-ups, subscriptions, or middlemen.
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a href="https://github.com/MorganOnCode/cardano402" className="btn">
                Read the code
                <span aria-hidden style={{ fontSize: 16 }}>→</span>
              </a>
              <a href="#how" className="btn ghost">See it work</a>
            </div>

            <div style={{ marginTop: 36, display: 'flex', gap: 24, fontSize: 13.5, opacity: 0.65 }}>
              <span><span className="mono" style={{ fontWeight: 700, color: 'var(--ink)' }}>10</span> verification checks</span>
              <span><span className="mono" style={{ fontWeight: 700, color: 'var(--ink)' }}>4</span> tokens (ADA · USDM · DJED · iUSD)</span>
              <span><span className="mono" style={{ fontWeight: 700, color: 'var(--ink)' }}>0</span> middlemen</span>
            </div>
          </div>

          {/* RECEIPT */}
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
            <Receipt />
            {showStickers && (
              <>
                <div className="sticker" style={{
                  top: -10, left: -30,
                  background: 'var(--lemon)', color: 'var(--ink)',
                  padding: '8px 14px', borderRadius: 999,
                  border: '2px solid var(--ink)',
                  transform: 'rotate(-8deg)',
                  fontSize: 13, fontWeight: 700,
                  boxShadow: '4px 4px 0 var(--ink)',
                }}>real response, real chain ✦</div>
                <div className="sticker" style={{
                  bottom: 30, right: -10,
                  background: 'var(--mint)', color: 'var(--ink)',
                  padding: '10px 12px', borderRadius: 12,
                  border: '2px solid var(--ink)',
                  transform: 'rotate(6deg)',
                  fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                  boxShadow: '4px 4px 0 var(--ink)',
                }}>tx confirmed ✓</div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Receipt() {
  return (
    <div style={{
      width: 380,
      background: 'white',
      filter: 'drop-shadow(0 30px 40px rgba(10, 16, 36, 0.18))',
      transform: 'rotate(-2deg)',
      position: 'relative',
      // zigzag bottom edge
      maskImage: 'linear-gradient(black, black), radial-gradient(circle at 8px 100%, transparent 6px, black 6.5px)',
      WebkitMask: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='380' height='800' preserveAspectRatio='none'><defs><pattern id='zig' x='0' y='0' width='16' height='10' patternUnits='userSpaceOnUse'><polygon points='0,0 8,10 16,0' fill='black'/></pattern></defs><rect width='380' height='790' fill='black'/><rect y='790' width='380' height='10' fill='url(%23zig)' transform='scale(1,-1) translate(0,-800)'/></svg>") top left / 100% 100% no-repeat`,
      padding: '32px 28px 50px',
      fontFamily: "'JetBrains Mono', monospace",
      color: '#0a1024',
    }}>
      {/* dotted top */}
      <div style={{ borderTop: '2px dashed #0a1024', opacity: 0.25, marginBottom: 18 }}></div>

      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '0.08em' }}>cardano402</div>
        <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>—— FACILITATOR · PREVIEW ——</div>
      </div>

      <div style={{ borderTop: '1px solid #0a1024', opacity: 0.2, margin: '14px 0' }}></div>

      <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 8 }}>REQ #00231</div>
      <Row k="POST" v="/api/summarize" />
      <Row k="status" v="402 Payment Required" highlight />

      <div style={{ borderTop: '1px dashed #0a1024', opacity: 0.25, margin: '14px 0' }}></div>

      <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 8 }}>PAYMENT REQ</div>
      <Row k="network" v="cardano:preview" />
      <Row k="asset" v="ADA" />
      <Row k="amount" v="2.000000" />
      <Row k="payTo" v="addr_test1…7q4f" />

      <div style={{ borderTop: '1px dashed #0a1024', opacity: 0.25, margin: '14px 0' }}></div>

      <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 8 }}>SUBTOTAL</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, fontWeight: 700 }}>
        <span>TOTAL</span>
        <span>₳ 2.00</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.6, marginTop: 4 }}>
        <span>≈ $0.0042 USD</span>
        <span>fee ₳ 0.17</span>
      </div>

      <div style={{ borderTop: '2px solid #0a1024', margin: '20px 0 14px' }}></div>

      <div style={{
        background: '#0a1024', color: 'white',
        padding: '10px 12px', borderRadius: 6,
        fontSize: 11, textAlign: 'center', letterSpacing: '0.06em',
        fontWeight: 700,
      }}>
        ✓ SETTLED · 1 BLOCK
      </div>

      <div style={{ fontSize: 10, opacity: 0.5, textAlign: 'center', marginTop: 14, lineHeight: 1.5 }}>
        thank you for paying<br />
        come back anytime
      </div>

      {/* barcode */}
      <div style={{ marginTop: 14, height: 32, background: 'repeating-linear-gradient(90deg, #0a1024 0 2px, transparent 2px 4px, #0a1024 4px 5px, transparent 5px 9px, #0a1024 9px 11px, transparent 11px 13px)' }}></div>
      <div style={{ fontSize: 9, textAlign: 'center', marginTop: 4, letterSpacing: '0.2em', opacity: 0.6 }}>
        TX b3a1…f0c9
      </div>
    </div>
  );
}

function Row({ k, v, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' }}>
      <span style={{ opacity: 0.55 }}>{k}</span>
      <span style={{
        fontWeight: highlight ? 700 : 500,
        color: highlight ? 'var(--blue)' : 'inherit',
      }}>{v}</span>
    </div>
  );
}

window.HeroReceipt = HeroReceipt;

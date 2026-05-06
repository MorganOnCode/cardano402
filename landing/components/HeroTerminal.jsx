// HeroTerminal.jsx — friendly terminal-as-diner-menu

function HeroTerminal({ showStickers }) {
  return (
    <section style={{ paddingTop: 40, paddingBottom: 100, position: 'relative', overflow: 'hidden' }}>
      <div className="wrap" style={{ position: 'relative' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.1fr',
          gap: 60,
          alignItems: 'center',
        }}>
          <div>
            <div className="pill" style={{ marginBottom: 28 }}>
              <span className="dot"></span>
              <span className="mono" style={{ fontSize: 12 }}>open source · apache-2.0 · zero npm deps in browser</span>
            </div>

            <h1 style={{
              fontSize: 'clamp(54px, 7vw, 92px)',
              lineHeight: 0.95,
              letterSpacing: '-0.03em',
              margin: '0 0 24px',
              fontWeight: 700,
              textWrap: 'balance',
            }}>
              Charge by the&nbsp;
              <span className="mono" style={{
                background: 'var(--ink)', color: 'var(--peach)',
                padding: '0 14px', borderRadius: 12, fontSize: '0.85em',
                display: 'inline-block', transform: 'rotate(-2deg)',
              }}>request</span>.
              <br />
              Settle on&nbsp;
              <span style={{
                fontFamily: "'Instrument Serif', serif", fontStyle: 'italic',
                fontWeight: 400, color: 'var(--blue)',
              }}>Cardano</span>.
            </h1>

            <p style={{
              fontSize: 19, lineHeight: 1.5, maxWidth: 480,
              opacity: 0.78, margin: '0 0 32px',
            }}>
              The x402 protocol turns HTTP itself into a payment system. cardano402 is the
              facilitator that makes it work on Cardano — verified, settled, and out of your way.
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a href="https://github.com/MorganOnCode/cardano402" className="btn blue">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                Open the repo
              </a>
              <a href="#how" className="btn ghost">curl me a demo</a>
            </div>
          </div>

          {/* terminal */}
          <div style={{ position: 'relative' }}>
            <Terminal />
            {showStickers && (
              <div className="sticker" style={{
                top: -16, right: 40,
                background: 'var(--peach)', color: 'var(--ink)',
                padding: '8px 14px', borderRadius: 999,
                border: '2px solid var(--ink)',
                transform: 'rotate(6deg)',
                fontSize: 13, fontWeight: 700,
                boxShadow: '4px 4px 0 var(--ink)',
              }}>$0.004 per call ✨</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Terminal() {
  const [step, setStep] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % 6), 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      background: '#0a1024',
      borderRadius: 22,
      border: '3px solid var(--ink)',
      boxShadow: '12px 12px 0 var(--peach)',
      overflow: 'hidden',
      fontFamily: "'JetBrains Mono', monospace",
      transform: 'rotate(1deg)',
    }}>
      {/* titlebar */}
      <div style={{
        background: '#161e3d',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57' }}></span>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }}></span>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }}></span>
        <span style={{ flex: 1, textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
          ~/agent — pay-per-call
        </span>
      </div>

      <div style={{ padding: '24px 22px', fontSize: 13.5, lineHeight: 1.7, color: '#e8ecff', height: 440, overflow: 'hidden' }}>
        <Line><Prompt /> curl -X POST api.example.com/summarize</Line>
        {step >= 1 && (
          <>
            <Line color="#ff8a4c">← HTTP/1.1 402 Payment Required</Line>
            <Line color="rgba(232,236,255,0.5)">  X-Payment: cardano:preview · 2 ADA → addr_test1…7q4f</Line>
          </>
        )}
        {step >= 2 && (
          <>
            <Line>{' '}</Line>
            <Line><Prompt /> sign && retry --with-payment</Line>
          </>
        )}
        {step >= 3 && (
          <>
            <Line color="rgba(123,224,163,0.9)">  ✓ tx built · 1 input · 2 outputs · fee 0.17 ADA</Line>
            <Line color="rgba(123,224,163,0.9)">  ✓ verified · 10/10 checks passed</Line>
            <Line color="rgba(123,224,163,0.9)">  ✓ submitted · b3a1…f0c9</Line>
          </>
        )}
        {step >= 4 && (
          <>
            <Line color="rgba(123,224,163,0.9)">  ✓ confirmed · 1 block</Line>
            <Line>{' '}</Line>
            <Line color="#7be0a3">← HTTP/1.1 200 OK</Line>
            <Line color="rgba(232,236,255,0.5)">{`  { "summary": "...", "x-payment-receipt": "b3a1…" }`}</Line>
          </>
        )}
        {step >= 5 && (
          <>
            <Line>{' '}</Line>
            <Line color="#ffd84d">  total time: 1.4s · cost: $0.0042</Line>
          </>
        )}
        <Line><Prompt /><span style={{ background: 'var(--peach)', display: 'inline-block', width: 8, height: 16, verticalAlign: -2, marginLeft: 4 }}></span></Line>
      </div>
    </div>
  );
}

function Prompt() {
  return <span style={{ color: '#7be0a3' }}>$</span>;
}
function Line({ children, color }) {
  return <div style={{ color: color || 'inherit', whiteSpace: 'pre' }}>{children}</div>;
}

window.HeroTerminal = HeroTerminal;

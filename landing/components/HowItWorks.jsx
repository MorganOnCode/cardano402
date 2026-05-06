// HowItWorks.jsx — section: intro + LiveDemo first, then a single sequence diagram

function HowItWorks() {
  return (
    <section id="how" style={{ background: 'var(--cream)', borderTop: '1.5px solid var(--ink)', borderBottom: '1.5px solid var(--ink)' }}>
      <div className="wrap">
        <div style={{ maxWidth: 720, marginBottom: 40 }}>
          <span className="eyebrow">§ how it works</span>
          <h2 className="section-title">
            One <span style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', color: 'var(--blue)' }}>handshake</span>. Settled in seconds.
          </h2>
          <p style={{ fontSize: 19, lineHeight: 1.5, opacity: 0.78, maxWidth: 600 }}>
            x402 is just HTTP with a payment in the middle. Your server says <span className="mono" style={{ fontSize: 16, fontWeight: 500 }}>402</span>, the
            client signs a Cardano tx, retries, your server verifies via cardano402, and the resource is delivered.
            That's it.
          </p>
        </div>

        {/* Live demo first */}
        <LiveDemo />

        {/* Sequence diagram below */}
        <div style={{ marginTop: 80 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>§ the four steps</div>
          <h3 style={{
            fontSize: 'clamp(26px, 3vw, 36px)',
            fontWeight: 700, letterSpacing: '-0.02em',
            margin: '0 0 32px', maxWidth: 640,
          }}>
            Behind every paid request, the same four moves.
          </h3>

          <SequenceDiagram />
        </div>
      </div>
    </section>
  );
}

const FLOW = [
  { n: '01', dir: 'right', color: 'var(--lemon)', label: 'GET /resource', sub: 'Client asks for a paid resource.' },
  { n: '02', dir: 'left',  color: 'var(--peach)', label: '402 + X-Payment', sub: 'Server names its price (amount, asset, address).' },
  { n: '03', dir: 'right', color: 'var(--mint)',  label: 'GET + signed tx',  sub: 'Client builds, signs, and re-sends with payment.' },
  { n: '04', dir: 'left',  color: 'var(--lilac)', label: '200 OK · settled', sub: '10 checks pass · Blockfrost submits · on-chain.' },
];

function SequenceDiagram() {
  return (
    <div style={{
      background: 'white',
      border: '2px solid var(--ink)',
      borderRadius: 24,
      padding: 'clamp(20px, 3vw, 36px)',
      boxShadow: '8px 8px 0 var(--ink)',
    }}>
      {/* Lane headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'clamp(20px, 6vw, 80px)',
        marginBottom: 24,
      }}>
        <Lane emoji="🤖" name="Client" sub="agent · app · script" />
        <Lane emoji="📡" name="Your API + cardano402" sub="server · facilitator" align="right" />
      </div>

      {/* Diagram body */}
      <div style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'clamp(20px, 6vw, 80px)',
        paddingBottom: 8,
      }}>
        {/* Two vertical lifelines */}
        <Lifeline />
        <Lifeline />

        {/* Steps stacked vertically */}
        <div style={{
          gridColumn: '1 / -1',
          display: 'flex', flexDirection: 'column',
          gap: 'clamp(14px, 2.4vw, 22px)',
          paddingTop: 4,
        }}>
          {FLOW.map((s) => <SeqStep key={s.n} {...s} />)}
        </div>
      </div>

      {/* Footer caption */}
      <div style={{
        marginTop: 28, paddingTop: 18,
        borderTop: '1.5px dashed rgba(10,16,36,0.2)',
        display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        fontSize: 13, opacity: 0.7,
      }}>
        <span className="mono">total: ~30–60s on Cardano Preview</span>
        <span>≈ <span className="mono">$0.004</span> end-to-end</span>
      </div>
    </div>
  );
}

function Lane({ emoji, name, sub, align }) {
  return (
    <div style={{ textAlign: align === 'right' ? 'right' : 'left' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 10,
        background: 'var(--paper-2)',
        border: '2px solid var(--ink)',
        borderRadius: 14,
        padding: '8px 14px',
      }}>
        <span style={{ fontSize: 22 }}>{emoji}</span>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.1 }}>{name}</div>
          <div className="mono" style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{sub}</div>
        </div>
      </div>
    </div>
  );
}

function Lifeline() {
  return (
    <div aria-hidden style={{
      position: 'absolute', top: 0, bottom: 0,
      width: 2,
      background: 'repeating-linear-gradient(to bottom, rgba(10,16,36,0.35) 0 6px, transparent 6px 12px)',
      pointerEvents: 'none',
    }} />
  );
}

// Hide the second lifeline using nth-child via inline style trick:
// Instead, render lifelines absolutely positioned at the lane centers via a wrapper.
// Simpler approach below: render them inside the grid columns directly.

function SeqStep({ n, dir, color, label, sub }) {
  const reverse = dir === 'left';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr',
      position: 'relative',
    }}>
      <div style={{
        position: 'relative',
        display: 'flex', alignItems: 'center',
        flexDirection: reverse ? 'row-reverse' : 'row',
        gap: 12,
      }}>
        {/* Step badge anchored to source side */}
        <div style={{
          background: color,
          border: '2px solid var(--ink)',
          borderRadius: 10,
          padding: '6px 10px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12, fontWeight: 700,
          flex: '0 0 auto',
          boxShadow: '3px 3px 0 var(--ink)',
        }}>{n}</div>

        {/* Arrow track */}
        <div style={{
          flex: 1,
          position: 'relative',
          display: 'flex', alignItems: 'center',
          minHeight: 56,
          flexDirection: reverse ? 'row-reverse' : 'row',
        }}>
          {/* line */}
          <div style={{
            position: 'absolute', left: 0, right: 0, top: '50%',
            height: 2.5, background: 'var(--ink)',
            transform: 'translateY(-50%)',
          }} />
          {/* arrow head */}
          <div aria-hidden style={{
            position: 'absolute',
            top: '50%',
            [reverse ? 'left' : 'right']: 0,
            transform: `translateY(-50%) ${reverse ? 'scaleX(-1)' : ''}`,
            width: 0, height: 0,
            borderTop: '7px solid transparent',
            borderBottom: '7px solid transparent',
            borderLeft: '11px solid var(--ink)',
          }} />
          {/* label pill on the line */}
          <div style={{
            position: 'relative', zIndex: 1,
            margin: '0 auto',
            background: 'white',
            border: '2px solid var(--ink)',
            borderRadius: 999,
            padding: '6px 14px',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            maxWidth: '85%',
            textAlign: 'center',
          }}>
            <div className="mono" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.01em' }}>
              {label}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, lineHeight: 1.3, marginTop: 2 }}>
              {sub}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.HowItWorks = HowItWorks;

// MorganBlock.jsx — about the builder

function MorganBlock() {
  const isMobile = (window.useIsMobile || (() => false))();
  return (
    <section id="morgan" style={{
      paddingTop: isMobile ? 60 : 100,
      paddingBottom: isMobile ? 56 : 80,
      position: 'relative',
    }}>
      <div className="wrap">
        <div style={{
          background: 'var(--ink)',
          color: 'var(--paper)',
          borderRadius: isMobile ? 22 : 28,
          padding: isMobile ? '40px 24px' : '60px 56px',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1.4fr',
          gap: isMobile ? 32 : 56,
          alignItems: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* big watermark — shrunk on mobile so it doesn't dwarf the card */}
          <div aria-hidden style={{
            position: 'absolute',
            right: isMobile ? -30 : -60,
            bottom: isMobile ? -60 : -120,
            fontSize: isMobile ? 180 : 360,
            fontWeight: 800, letterSpacing: '-0.05em',
            color: 'rgba(255, 138, 76, 0.08)',
            fontFamily: 'Bricolage Grotesque', lineHeight: 1,
            pointerEvents: 'none',
          }}>402</div>

          <div style={{
            position: 'relative',
            display: isMobile ? 'flex' : 'block',
            justifyContent: 'center',
          }}>
            {/* avatar placeholder */}
            <div style={{
              width: isMobile ? 150 : 180,
              height: isMobile ? 184 : 220,
              background: 'repeating-linear-gradient(135deg, var(--peach) 0 14px, #ff9d68 14px 28px)',
              borderRadius: 18,
              border: '2px solid var(--paper)',
              display: 'grid', placeItems: 'center',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11, color: 'var(--ink)',
              transform: 'rotate(-3deg)',
            }}>
              [photo of Morgan]
            </div>
            <div style={{
              position: 'absolute',
              bottom: isMobile ? -6 : -10,
              left: isMobile ? '60%' : 100,
              background: 'var(--lemon)', color: 'var(--ink)',
              padding: '6px 12px', borderRadius: 999,
              border: '2px solid var(--ink)',
              fontSize: 12, fontWeight: 700,
              transform: 'rotate(8deg)',
              fontFamily: "'JetBrains Mono', monospace",
            }}>@MorganOnCode</div>
          </div>

          <div style={{ position: 'relative' }}>
            <span className="eyebrow" style={{ color: 'var(--peach)', opacity: 1 }}>§ who built this</span>
            <h2 style={{
              fontSize: isMobile ? 'clamp(26px, 7vw, 34px)' : 'clamp(34px, 4vw, 52px)',
              lineHeight: 1.15, letterSpacing: '-0.025em',
              fontWeight: 700, margin: '10px 0 20px',
              textWrap: 'balance',
              paddingBottom: '0.15em',
            }}>
              Hi, I'm Morgan. I build things that{' '}
              <span style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontWeight: 400, color: 'var(--peach)' }}>shouldn't exist yet</span>.
            </h2>
            <p style={{
              fontSize: isMobile ? 15.5 : 17,
              lineHeight: 1.55, opacity: 0.85,
              margin: '0 0 24px', maxWidth: 560,
            }}>
              cardano402 is a portfolio piece — a working bet that the agent web needs payment rails
              that look more like HTTP and less like Stripe. If you're building something in this space (or you want to), let's talk.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a href="https://github.com/MorganOnCode/cardano402" className="btn peach" style={{ color: 'var(--ink)' }}>
                See the code →
              </a>
              <a href="https://github.com/MorganOnCode" className="btn ghost" style={{ borderColor: 'var(--paper)', color: 'var(--paper)' }}>
                More from me
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

window.MorganBlock = MorganBlock;

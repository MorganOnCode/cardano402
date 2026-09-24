// app.jsx — top-level shell. Mode toggle (Normal=Receipt+Peach, Dev=Terminal+Mint).

const ACCENTS = {
  normal: '#ff8a4c', // peach
  dev: '#7be0a3',    // mint
};

function App() {
  const [mode, setMode] = React.useState(() => {
    try { return localStorage.getItem('c402_mode') || 'normal'; } catch { return 'normal'; }
  });

  React.useEffect(() => {
    document.documentElement.style.setProperty('--peach', ACCENTS[mode] || ACCENTS.normal);
    document.body.dataset.mode = mode;
    try { localStorage.setItem('c402_mode', mode); } catch {}
  }, [mode]);

  return (
    <>
      <Nav mode={mode} setMode={setMode} />
      {mode === 'normal' ? <HeroReceipt showStickers={true} /> : <HeroTerminal showStickers={true} />}
      <HowItWorks />
      <UseCases layout="rolodex" />
      <MorganBlock />
      <SiteFooter />
    </>
  );
}

function ModeToggle({ mode, setMode }) {
  return (
    <div role="tablist" aria-label="Site mode" style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: 'var(--ink)', borderRadius: 999, padding: 4,
      boxShadow: '0 0 0 1.5px var(--ink)',
    }}>
      {[
        { v: 'normal', label: 'Normal' },
        { v: 'dev', label: 'Dev' },
      ].map((o) => {
        const active = mode === o.v;
        return (
          <button key={o.v} role="tab" aria-selected={active}
            onClick={() => setMode(o.v)}
            style={{
              border: 'none', cursor: 'pointer',
              padding: '7px 14px', borderRadius: 999,
              background: active ? (o.v === 'dev' ? '#7be0a3' : '#ff8a4c') : 'transparent',
              color: active ? '#0a1024' : 'rgba(251,246,236,0.85)',
              fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
              letterSpacing: o.v === 'dev' ? '0.04em' : 0,
              transition: 'background .15s ease, color .15s ease',
              fontFamily: o.v === 'dev' && active ? "'JetBrains Mono', monospace" : 'inherit',
            }}>
            {o.v === 'dev' && <span aria-hidden style={{ marginRight: 6, opacity: 0.7 }}>{'</>'}</span>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const GH_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);

function Nav({ mode, setMode }) {
  const [open, setOpen] = React.useState(false);

  // Close drawer when an in-page link is clicked or window grows past mobile.
  React.useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(max-width: 900px)');
    const handler = (e) => { if (!e.matches) setOpen(false); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
    };
  }, []);

  const closeDrawer = () => setOpen(false);

  return (
    <div className="wrap">
      <nav className="nav">
        <a href="#" className="logo">
          <span className="logo-mark">402</span>
          <span>cardano<span style={{ color: 'var(--blue)' }}>402</span></span>
        </a>
        <div className="nav-links" style={{ gap: 22 }}>
          <a href="#how">How it works</a>
          <a href="#cases">Use cases</a>
          <a href="#morgan">About</a>
          <ModeToggle mode={mode} setMode={setMode} />
          <a href="https://github.com/MorganOnCode/cardano402" className="btn ghost" style={{ padding: '8px 14px' }}>
            {GH_ICON}
            GitHub
          </a>
        </div>
        <button
          className="nav-burger"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="nav-drawer"
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden></span>
        </button>
      </nav>
      <div
        id="nav-drawer"
        className={open ? 'nav-drawer open' : 'nav-drawer'}
        role="region"
        aria-label="Site navigation"
      >
        <a href="#how" onClick={closeDrawer}>How it works</a>
        <a href="#cases" onClick={closeDrawer}>Use cases</a>
        <a href="#morgan" onClick={closeDrawer}>About</a>
        <div style={{ paddingTop: 4 }}><ModeToggle mode={mode} setMode={setMode} /></div>
        <a
          href="https://github.com/MorganOnCode/cardano402"
          className="btn ghost"
          style={{ alignSelf: 'flex-start', padding: '8px 14px', marginTop: 4 }}
          onClick={closeDrawer}
        >
          {GH_ICON}
          GitHub
        </a>
      </div>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer>
      <div className="wrap">
        <div className="row">
          <div className="col" style={{ maxWidth: 320 }}>
            <a href="#" className="logo" style={{ marginBottom: 16 }}>
              <span className="logo-mark">402</span>
              <span>cardano<span style={{ color: 'var(--blue)' }}>402</span></span>
            </a>
            <p style={{ fontSize: 14.5, lineHeight: 1.55, opacity: 0.75 }}>
              An open implementation of the x402 payment protocol on Cardano. Built by Morgan as a portfolio project — and a small bet on a more honest, agent-native web.
            </p>
          </div>
          <div className="col">
            <h4>Project</h4>
            <a href="https://github.com/MorganOnCode/cardano402">GitHub repo</a>
            <a href="#how">How it works</a>
            <a href="#cases">Use cases</a>
            <a href="https://github.com/MorganOnCode/cardano402/blob/master/docs/architecture.md">Architecture</a>
          </div>
          <div className="col">
            <h4>Morgan</h4>
            <a href="https://github.com/MorganOnCode">@MorganOnCode</a>
            <a href="#morgan">Hire / collab</a>
            <a href="#morgan">Other work</a>
          </div>
          <div className="col">
            <h4>Resources</h4>
            <a href="https://x402.org" target="_blank" rel="noopener">x402.org</a>
            <a href="https://cardano.org" target="_blank" rel="noopener">cardano.org</a>
            <a href="https://blockfrost.io" target="_blank" rel="noopener">Blockfrost</a>
          </div>
        </div>
        <div className="signoff">
          <span className="mono">HTTP/1.1 200 OK</span> &nbsp;·&nbsp; Apache-2.0 &nbsp;·&nbsp; © 2026 Morgan
        </div>
      </div>
    </footer>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

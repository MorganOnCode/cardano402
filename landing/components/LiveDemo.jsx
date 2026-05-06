// LiveDemo.jsx — wires up the real /demo/run SSE endpoint and /demo/status
// Two modes: Simple (narrative stepper) and Technical (raw JSON)

const STEP_LABELS_SIMPLE = [
  { n: 1, label: 'Knock on the door', tech: 'Health check' },
  { n: 2, label: 'Ask what they take', tech: 'Query capabilities' },
  { n: 3, label: 'Open the wallet', tech: 'Init testnet wallet' },
  { n: 4, label: 'Sign the receipt', tech: 'Build & sign transaction' },
  { n: 5, label: 'Show ID at the door', tech: 'Verify payment' },
  { n: 6, label: 'Hand over the cash', tech: 'Submit to testnet' },
  { n: 7, label: 'Wait for the stamp', tech: 'Confirm on-chain' },
];

// Default to same-origin (production). Falls back to live host when previewing offsite.
const FACILITATOR_BASE = (typeof window !== 'undefined' && window.location.hostname.endsWith('cardano402.com'))
  ? '' // same-origin
  : 'https://cardano402.com';

function LiveDemo() {
  const [mode, setMode] = React.useState('simple');
  const [status, setStatus] = React.useState({ running: false, cooldownRemainingMs: 0, ready: true });
  const [steps, setSteps] = React.useState([]); // array of { step, total, label, detail }
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [running, setRunning] = React.useState(false);
  const [healthData, setHealthData] = React.useState(null);
  const [supportedData, setSupportedData] = React.useState(null);
  const [cooldownLeft, setCooldownLeft] = React.useState(0);

  // poll /demo/status on mount + every 1.5s while running or cooldown
  React.useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${FACILITATOR_BASE}/demo/status`);
        if (!r.ok) return;
        const d = await r.json();
        if (!alive) return;
        setStatus(d);
        setCooldownLeft(Math.ceil((d.cooldownRemainingMs || 0) / 1000));
      } catch (e) { /* offline */ }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(id); };
  }, [running]);

  // Fetch /health and /supported once for technical mode
  React.useEffect(() => {
    if (mode !== 'technical' || healthData) return;
    (async () => {
      try {
        const [h, s] = await Promise.all([
          fetch(`${FACILITATOR_BASE}/health`).then((r) => r.json()),
          fetch(`${FACILITATOR_BASE}/supported`).then((r) => r.json()),
        ]);
        setHealthData(h);
        setSupportedData(s);
      } catch (e) {
        setHealthData({ error: String(e) });
      }
    })();
  }, [mode, healthData]);

  const runDemo = async () => {
    setSteps([]); setResult(null); setError(null); setRunning(true);
    try {
      const res = await fetch(`${FACILITATOR_BASE}/demo/run`, { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        setError(j.message || j.error || `HTTP ${res.status}`);
        setRunning(false);
        return;
      }
      // Parse SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() || '';
        for (const evt of events) {
          const lines = evt.split('\n');
          let type = 'message', data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) type = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (!data) continue;
          let parsed; try { parsed = JSON.parse(data); } catch { continue; }
          if (type === 'step') {
            setSteps((prev) => {
              const copy = [...prev];
              copy[parsed.step - 1] = parsed;
              return copy;
            });
          } else if (type === 'result') {
            setResult(parsed);
          } else if (type === 'error') {
            setError(parsed.message || 'Unknown error');
          }
        }
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setRunning(false);
    }
  };

  const disabled = running || status.running || (status.cooldownRemainingMs > 0);
  const buttonLabel = running ? 'Running…'
    : status.running ? 'Another demo running…'
    : (status.cooldownRemainingMs > 0) ? `Cooling down · ${cooldownLeft}s`
    : result ? 'Test Again ↻'
    : 'Test Now';
  const showHands = !running && !status.running && status.cooldownRemainingMs === 0;

  return (
    <div style={{
      marginTop: 56,
      background: 'white',
      border: '2px solid var(--ink)',
      borderRadius: 24,
      overflow: 'hidden',
      boxShadow: '8px 8px 0 var(--ink)',
    }}>
      {/* Header strip */}
      <div style={{
        padding: '20px 28px',
        borderBottom: '2px solid var(--ink)',
        background: 'var(--paper-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap',
      }}>
        <div>
          <div className="mono" style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            try it · cardano preview testnet
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Run a real on-chain payment, right now.
          </div>
        </div>

        {/* Mode tabs */}
        <div style={{
          display: 'inline-flex',
          background: 'var(--ink)', borderRadius: 999, padding: 3,
        }}>
          {['simple', 'technical'].map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              border: 'none', cursor: 'pointer',
              padding: '8px 16px', borderRadius: 999,
              background: mode === m ? 'var(--peach)' : 'transparent',
              color: mode === m ? 'var(--ink)' : 'var(--paper)',
              fontFamily: 'inherit', fontWeight: 600, fontSize: 13,
              transition: 'background .15s ease',
            }}>{m === 'simple' ? 'Simple' : 'Technical'}</button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: 28 }}>
        {/* Run button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
          {showHands && (
            <span aria-hidden style={{
              fontSize: 26, display: 'inline-block',
              animation: 'c402-point 1s ease-in-out infinite',
            }}>👉</span>
          )}
          <button
            onClick={runDemo}
            disabled={disabled}
            className="btn"
            style={{
              background: disabled ? '#999' : 'var(--blue)',
              color: 'white',
              cursor: disabled ? 'not-allowed' : 'pointer',
              padding: '16px 26px',
              fontSize: 16,
              fontWeight: 700,
              boxShadow: showHands ? '4px 4px 0 var(--ink)' : 'none',
              animation: showHands ? 'c402-pulse 1.6s ease-in-out infinite' : 'none',
            }}>
            {running && <Spinner />}
            {buttonLabel}
          </button>
          <style>{`
            @keyframes c402-point {
              0%, 100% { transform: translateX(0); }
              50% { transform: translateX(6px); }
            }
            @keyframes c402-point-rev {
              0%, 100% { transform: scaleX(-1) translateX(0); }
              50% { transform: scaleX(-1) translateX(6px); }
            }
            @keyframes c402-pulse {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-2px); }
            }
          `}</style>
          <span className="mono" style={{ fontSize: 12, opacity: 0.55 }}>
            2 ADA self-payment · Morgan's preview wallet · ~30–60s
          </span>
        </div>

        {/* Mode content */}
        {mode === 'simple' ? (
          <SimpleMode steps={steps} result={result} error={error} running={running} />
        ) : (
          <TechnicalMode
            steps={steps} result={result} error={error}
            healthData={healthData} supportedData={supportedData}
          />
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block',
      width: 14, height: 14,
      border: '2px solid rgba(255,255,255,0.4)',
      borderTopColor: 'white',
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}

function SimpleMode({ steps, result, error, running }) {
  return (
    <div>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {STEP_LABELS_SIMPLE.map((s, i) => {
          const live = steps[i];
          const isDone = live && (i + 1 < (live.step || 0) || (live.detail && /✅|OK|passed|Confirmed|submitted|Tx hash/i.test(live.detail)));
          const isActive = live && !isDone && running;
          const idle = !live;
          return (
            <li key={s.n} style={{
              display: 'grid', gridTemplateColumns: '38px 1fr', alignItems: 'flex-start', gap: 14,
              padding: '12px 16px',
              borderRadius: 14,
              background: isActive ? 'var(--lemon)' : isDone ? 'var(--mint)' : 'var(--paper)',
              border: '1.5px solid var(--ink)',
              opacity: idle && !running ? 0.5 : 1,
              transition: 'background .2s ease, opacity .2s ease',
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: isDone ? 'var(--ink)' : isActive ? 'var(--ink)' : 'transparent',
                color: isDone || isActive ? 'var(--paper)' : 'var(--ink)',
                border: '1.5px solid var(--ink)',
                display: 'grid', placeItems: 'center',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12, fontWeight: 700,
              }}>{isDone ? '✓' : s.n}</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{s.label}</div>
                {live && (
                  <div className="mono" style={{ fontSize: 12, opacity: 0.7, marginTop: 4, wordBreak: 'break-all' }}>
                    {live.detail}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {result && <ResultBlock result={result} />}
      {error && <ErrorBlock error={error} />}
    </div>
  );
}

function TechnicalMode({ steps, result, error, healthData, supportedData }) {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <JsonBlock title="GET /health" data={healthData} />
      <JsonBlock title="GET /supported" data={supportedData} />

      <div>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', opacity: 0.6, marginBottom: 8, textTransform: 'uppercase' }}>
          POST /demo/run · SSE stream
        </div>
        <pre style={{
          background: '#0a1024', color: '#e8ecff',
          padding: 16, borderRadius: 12,
          fontSize: 12.5, lineHeight: 1.6,
          fontFamily: "'JetBrains Mono', monospace",
          margin: 0, maxHeight: 320, overflow: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
{steps.length === 0 ? <span style={{ opacity: 0.5 }}>// run the demo to stream step events</span>
  : steps.map((s, i) => s ? (
  <div key={i}>
    <span style={{ color: '#7be0a3' }}>event: step</span>{'\n'}
    <span style={{ color: '#ffd84d' }}>data:</span> {JSON.stringify(s)}{'\n\n'}
  </div>) : null)}
{result && (
  <div>
    <span style={{ color: '#ff8a4c' }}>event: result</span>{'\n'}
    <span style={{ color: '#ffd84d' }}>data:</span> {JSON.stringify(result, null, 2)}{'\n'}
  </div>
)}
{error && (
  <div>
    <span style={{ color: '#ff4d8d' }}>event: error</span>{'\n'}
    <span style={{ color: '#ffd84d' }}>data:</span> {JSON.stringify({ message: error })}
  </div>
)}
        </pre>
      </div>

      {result && <ResultBlock result={result} />}
    </div>
  );
}

function JsonBlock({ title, data }) {
  const [copied, setCopied] = React.useState(false);
  const text = data ? JSON.stringify(data, null, 2) : '// loading…';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', opacity: 0.6, textTransform: 'uppercase' }}>{title}</div>
        <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, opacity: 0.7, fontFamily: 'inherit' }}>
          {copied ? '✓ copied' : 'copy'}
        </button>
      </div>
      <pre style={{
        background: '#0a1024', color: '#e8ecff',
        padding: 16, borderRadius: 12,
        fontSize: 12.5, lineHeight: 1.6,
        fontFamily: "'JetBrains Mono', monospace",
        margin: 0, maxHeight: 220, overflow: 'auto',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      }}>{text}</pre>
    </div>
  );
}

function ResultBlock({ result }) {
  return (
    <div style={{
      marginTop: 20,
      background: 'var(--mint)',
      border: '2px solid var(--ink)',
      borderRadius: 16,
      padding: 20,
    }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.7, marginBottom: 8 }}>
        ✓ settled on {result.network || 'cardano:preview'}
      </div>
      <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>
        {(Number(result.amount) / 1_000_000).toFixed(2)} ADA paid
      </div>
      <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all', opacity: 0.8, marginBottom: 12 }}>
        tx · {result.txHash}
      </div>
      <a href={result.scanUrl} target="_blank" rel="noopener" className="btn" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
        View on Cardanoscan ↗
      </a>
    </div>
  );
}

function ErrorBlock({ error }) {
  return (
    <div style={{
      marginTop: 20,
      background: '#ffe0e6', border: '2px solid var(--ink)',
      borderRadius: 16, padding: 20,
    }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.7, marginBottom: 8 }}>
        ✕ run failed
      </div>
      <div className="mono" style={{ fontSize: 13, lineHeight: 1.5, wordBreak: 'break-word' }}>{error}</div>
    </div>
  );
}

window.LiveDemo = LiveDemo;

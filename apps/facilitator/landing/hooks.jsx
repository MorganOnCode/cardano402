// Shared client-side hooks for landing components.
// Loaded before components in index.html so each component can read window.useIsMobile().

function useIsMobile(breakpoint) {
  const bp = typeof breakpoint === 'number' ? breakpoint : 768;
  const query = `(max-width: ${bp}px)`;
  const [matches, setMatches] = React.useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });
  React.useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
    };
  }, [query]);
  return matches;
}

window.useIsMobile = useIsMobile;

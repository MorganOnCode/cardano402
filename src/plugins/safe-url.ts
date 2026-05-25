export function redactUrlQuery(url: string): string {
  const markerIndex = url.search(/[?#]/u);
  if (markerIndex === -1) return url;
  return `${url.slice(0, markerIndex)}?[REDACTED]`;
}

export function boundedRouteLabel(routePattern: string | undefined): string {
  return routePattern ?? '__unmatched__';
}

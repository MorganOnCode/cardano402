export function demoEnabled(env: CloudflareBindings): boolean {
  return (
    String(env.LIVE_DEMO_ENABLED) === 'true' &&
    env.CARDANO_NETWORK === 'cardano:preview' &&
    !!env.BLOCKFROST_PROJECT_ID?.startsWith('preview')
  );
}

export interface TabIdentity {
  tab: string;
  server: string;
}

// rk.tab/rk.server are validated before they can become argv elements.
const TAB_PATTERN = /^@\d+$/;
const SERVER_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function readTabIdentity(get: (key: string) => unknown): TabIdentity | null {
  const tab = get('rk.tab');
  const server = get('rk.server');
  if (typeof tab !== 'string' || typeof server !== 'string') return null;
  if (!TAB_PATTERN.test(tab) || !SERVER_PATTERN.test(server)) return null;
  return { tab, server };
}

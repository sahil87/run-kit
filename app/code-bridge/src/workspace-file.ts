import { readTabIdentity, TabIdentity } from './tab';

/**
 * Derive the tab identity from a .code-workspace file's contents: the
 * top-level `settings` block is fed through the shared `readTabIdentity`
 * validator (rk.tab / rk.server). On the broken first boot VS Code boots from
 * its empty cached configuration, so the live configuration carries no
 * identity — the workspace file the daemon wrote is the only place it exists.
 * Any defect — non-JSON contents, a missing or non-object `settings`, invalid
 * values — yields null: a zero-folder window whose identity cannot be proven
 * produces no side effects.
 */
export function identityFromWorkspaceFile(contents: string): TabIdentity | null {
  let doc: unknown;
  try {
    doc = JSON.parse(contents);
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null || !('settings' in doc)) return null;
  const settings = (doc as { settings: unknown }).settings;
  if (typeof settings !== 'object' || settings === null) return null;
  return readTabIdentity((key) => (settings as Record<string, unknown>)[key]);
}

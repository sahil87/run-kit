import type { ProjectSession } from "../types";

/** GET /api/sessions — List all sessions with windows */
export async function getSessions(): Promise<ProjectSession[]> {
  throw new Error("not implemented");
}

/** POST /api/sessions — Create a new session */
export async function createSession(
  name: string,
  cwd?: string,
): Promise<void> {
  throw new Error("not implemented");
}

/** POST /api/sessions/:session/kill — Kill a session */
export async function killSession(session: string): Promise<void> {
  throw new Error("not implemented");
}

/** POST /api/sessions/:session/windows — Create a new window */
export async function createWindow(
  session: string,
  name: string,
  cwd?: string,
): Promise<void> {
  throw new Error("not implemented");
}

/** POST /api/sessions/:session/windows/:index/kill — Kill a window */
export async function killWindow(
  session: string,
  index: number,
): Promise<void> {
  throw new Error("not implemented");
}

/** POST /api/sessions/:session/windows/:index/rename — Rename a window */
export async function renameWindow(
  session: string,
  index: number,
  name: string,
): Promise<void> {
  throw new Error("not implemented");
}

/** POST /api/sessions/:session/windows/:index/keys — Send keystrokes */
export async function sendKeys(
  session: string,
  index: number,
  keys: string,
): Promise<void> {
  throw new Error("not implemented");
}

/** GET /api/directories?prefix=:path — Directory autocomplete */
export async function getDirectories(prefix: string): Promise<string[]> {
  throw new Error("not implemented");
}

/** POST /api/sessions/:session/upload — Upload a file */
export async function uploadFile(
  session: string,
  file: File,
  window?: number,
): Promise<string> {
  throw new Error("not implemented");
}

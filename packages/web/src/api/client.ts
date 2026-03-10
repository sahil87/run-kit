import type { ProjectSession, WindowInfo } from "@/types";

export type { ProjectSession, WindowInfo };

export type SessionAction =
  | { action: "createSession"; name: string; cwd?: string }
  | { action: "createWindow"; session: string; name: string; cwd?: string }
  | { action: "killSession"; session: string }
  | { action: "killWindow"; session: string; index: number }
  | { action: "renameWindow"; session: string; index: number; name: string }
  | { action: "sendKeys"; session: string; window: number; keys: string };

export async function getSessions(): Promise<ProjectSession[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
  return res.json();
}

export async function postSessionAction(action: SessionAction): Promise<{ ok: boolean }> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Action failed: ${res.status}`);
  }
  return res.json();
}

export async function getDirectories(prefix: string): Promise<string[]> {
  const res = await fetch(`/api/directories?prefix=${encodeURIComponent(prefix)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.directories ?? [];
}

export async function uploadFile(
  file: File,
  session: string,
  windowIndex?: string,
): Promise<{ ok: boolean; path: string } | null> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("session", session);
  if (windowIndex) formData.append("window", windowIndex);

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) return null;
  return res.json();
}

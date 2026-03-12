import type { ProjectSession } from "@/types";

export type { ProjectSession };

/** Throw an error from a JSON error response, falling back to status text. */
async function throwOnError(res: Response): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new Error((data as { error?: string }).error ?? `Request failed: ${res.status}`);
}

export async function getSessions(): Promise<ProjectSession[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function createSession(
  name: string,
  cwd?: string,
): Promise<{ ok: boolean }> {
  const body: Record<string, string> = { name };
  if (cwd) body.cwd = cwd;
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function killSession(session: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(session)}/kill`, {
    method: "POST",
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function createWindow(
  session: string,
  name: string,
  cwd?: string,
): Promise<{ ok: boolean }> {
  const body: Record<string, string> = { name };
  if (cwd) body.cwd = cwd;
  const res = await fetch(`/api/sessions/${encodeURIComponent(session)}/windows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function killWindow(
  session: string,
  index: number,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(session)}/windows/${index}/kill`,
    { method: "POST" },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function renameWindow(
  session: string,
  index: number,
  name: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(session)}/windows/${index}/rename`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function sendKeys(
  session: string,
  index: number,
  keys: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(session)}/windows/${index}/keys`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    },
  );
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function getDirectories(prefix: string): Promise<string[]> {
  const res = await fetch(`/api/directories?prefix=${encodeURIComponent(prefix)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.directories ?? [];
}

export async function uploadFile(
  session: string,
  file: File,
  window?: string,
): Promise<{ ok: boolean; path: string }> {
  const formData = new FormData();
  formData.append("file", file);
  if (window) formData.append("window", window);

  const res = await fetch(`/api/sessions/${encodeURIComponent(session)}/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

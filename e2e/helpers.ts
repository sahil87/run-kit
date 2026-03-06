import { request } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

export async function createTestSession(name: string): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const res = await ctx.post("/api/sessions", {
    data: { action: "createSession", name },
  });
  if (!res.ok()) {
    throw new Error(`Failed to create test session "${name}": ${res.status()} ${await res.text()}`);
  }
  await ctx.dispose();
}

export async function killTestSession(name: string): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const res = await ctx.post("/api/sessions", {
    data: { action: "killSession", session: name },
  });
  // Best-effort cleanup — session may already be gone
  if (!res.ok() && res.status() !== 500) {
    throw new Error(`Failed to kill test session "${name}": ${res.status()} ${await res.text()}`);
  }
  await ctx.dispose();
}

export const TEST_SESSION = "e2e-test";

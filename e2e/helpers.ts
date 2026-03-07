import { request } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

export async function createTestSession(name: string): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  try {
    const res = await ctx.post("/api/sessions", {
      data: { action: "createSession", name },
    });
    if (!res.ok()) {
      throw new Error(`Failed to create test session "${name}": ${res.status()} ${await res.text()}`);
    }
  } finally {
    await ctx.dispose();
  }
}

export async function killTestSession(name: string): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  try {
    const res = await ctx.post("/api/sessions", {
      data: { action: "killSession", session: name },
    });
    if (!res.ok()) {
      const body = await res.text();
      // Best-effort cleanup — only ignore "not found" errors (session already gone)
      const isNotFound = res.status() === 500 && body.toLowerCase().includes("not found");
      if (!isNotFound) {
        throw new Error(`Failed to kill test session "${name}": ${res.status()} ${body}`);
      }
    }
  } finally {
    await ctx.dispose();
  }
}

export const TEST_SESSION = "e2e-test";

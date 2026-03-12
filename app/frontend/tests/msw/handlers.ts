import { http, HttpResponse } from "msw";

export const handlers = [
  // GET /api/sessions — returns empty array
  http.get("/api/sessions", () => {
    return HttpResponse.json([]);
  }),

  // GET /api/sessions/stream — no-op SSE stub
  http.get("/api/sessions/stream", () => {
    return new HttpResponse(null, { status: 200 });
  }),

  // GET /api/directories — returns empty array
  http.get("/api/directories", () => {
    return HttpResponse.json({ directories: [] });
  }),

  // POST /api/sessions — create session
  http.post("/api/sessions", () => {
    return HttpResponse.json({ ok: true }, { status: 201 });
  }),

  // POST /api/sessions/:session/kill — kill session
  http.post("/api/sessions/:session/kill", () => {
    return HttpResponse.json({ ok: true });
  }),
];

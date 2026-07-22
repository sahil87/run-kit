import { test, expect } from "@playwright/test";

// PWA identity assets served dynamically by the Go backend through the Vite
// dev proxy (260722-eo8e). All assertions are tint-agnostic: the box running
// the e2e suite may or may not have an instance accent in its real
// ~/.rk/settings.yaml, so the tests pin the serving pipeline (proxy → Go
// handler → valid asset), never the tint state.
test.describe("PWA assets", () => {
  test("manifest is served by the Go handler through the dev proxy", async ({
    request,
  }) => {
    const res = await request.get("/manifest.json");
    expect(res.status()).toBe(200);
    // The Go handler answers application/manifest+json; Vite's public-dir
    // static serving would answer application/json — so this content-type is
    // the proof the request traversed the proxy to the dynamic handler.
    expect(res.headers()["content-type"]).toContain(
      "application/manifest+json",
    );
    const manifest = await res.json();
    expect(manifest.name).toBe("RunKit");
    expect(manifest.icons).toHaveLength(3);
    for (const icon of manifest.icons) {
      // Tint-agnostic: with an accent set the srcs carry ?c=<descriptor>.
      expect(icon.src).toMatch(/^\/generated-icons\/icon-.*\.png(\?c=.*)?$/);
    }
  });

  test("dock icon PNG is served intact", async ({ request }) => {
    const res = await request.get("/generated-icons/icon-192.png");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    const body = await res.body();
    // PNG magic bytes — the asset decodes as a real PNG regardless of tint.
    expect(body.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  test("favicon SVG is served with revalidation caching", async ({
    request,
  }) => {
    const res = await request.get("/generated-icons/favicon.svg");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/svg+xml");
    // no-cache is set by the Go favicon handler (the tint resolves from
    // settings per request, so tabs must revalidate) — further proof the
    // dynamic handler answered.
    expect(res.headers()["cache-control"]).toContain("no-cache");
    expect(await res.text()).toContain("<svg");
  });
});

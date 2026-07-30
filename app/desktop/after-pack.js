/**
 * electron-builder afterPack hook: ad-hoc sign the packed `.app`.
 *
 * `identity: null` makes electron-builder SKIP macOS signing entirely — it
 * does not apply an ad-hoc signature (verified on the v3.12.2 release run:
 * the arm64 app carried only the Electron prebuilt's linker signature — no
 * sealed resources, Info.plist not bound — and the x64 app was not signed at
 * all). arm64 macOS kills unsigned apps at launch, and the release workflow's
 * codesign verify gate rejects both states. Force a fresh deep ad-hoc
 * signature over the whole bundle here, after packing and before the DMG is
 * built, so the app inside the DMG is the signed one.
 *
 * Build-time only — not part of the packaged app (`files` ships `dist/**`).
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
};

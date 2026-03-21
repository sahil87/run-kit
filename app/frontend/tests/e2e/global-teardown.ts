import { execSync } from "node:child_process";

export default function globalTeardown() {
  const server = process.env.E2E_TMUX_SERVER ?? "rk-e2e";
  try {
    execSync(`tmux -L ${server} kill-server`, { stdio: "ignore" });
  } catch {
    // Server may already be gone
  }
}

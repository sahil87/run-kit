import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { Config, ProjectConfig } from "./types";

const CONFIG_FILENAME = "run-kit.yaml";

let cached: Config | null = null;

/** Load and validate run-kit.yaml from the repo root. Throws on missing or malformed file. */
export function loadConfig(): Config {
  const configPath = resolve(process.cwd(), CONFIG_FILENAME);

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    throw new Error(
      `Configuration file not found: ${configPath}\n` +
        `Create a ${CONFIG_FILENAME} file in the repo root. Example:\n\n` +
        `projects:\n` +
        `  my-app:\n` +
        `    path: ~/code/my-app\n` +
        `    fab_kit: true`,
    );
  }

  const parsed = parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || !("projects" in parsed)) {
    throw new Error(
      `Invalid ${CONFIG_FILENAME}: missing "projects" key.\n` +
        `Expected format:\n\n` +
        `projects:\n` +
        `  project-name:\n` +
        `    path: /absolute/or/tilde/path\n` +
        `    fab_kit: true`,
    );
  }

  const config = parsed as { projects: Record<string, unknown> };
  const projects: Record<string, ProjectConfig> = {};

  for (const [key, value] of Object.entries(config.projects)) {
    if (!value || typeof value !== "object" || !("path" in value)) {
      throw new Error(
        `Invalid project "${key}" in ${CONFIG_FILENAME}: missing "path" field.`,
      );
    }
    const entry = value as Record<string, unknown>;
    projects[key] = {
      path: String(entry.path),
      fab_kit: entry.fab_kit === true,
    };
  }

  cached = { projects };
  return cached;
}

/** Get cached config (loads on first call). */
export function getConfig(): Config {
  if (!cached) {
    return loadConfig();
  }
  return cached;
}

/** Get all configured project names. */
export function getProjectNames(): string[] {
  return Object.keys(getConfig().projects);
}

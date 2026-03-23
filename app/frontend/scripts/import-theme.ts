#!/usr/bin/env npx tsx
/**
 * Import a theme from iTerm2-Color-Schemes into configs/themes.json.
 *
 * Usage:
 *   npx tsx app/frontend/scripts/import-theme.ts "Dracula"
 *   npx tsx app/frontend/scripts/import-theme.ts "Catppuccin Frappe" --category dark
 *   npx tsx app/frontend/scripts/import-theme.ts "Catppuccin Frappe" --id catppuccin-frappe
 *   npx tsx app/frontend/scripts/import-theme.ts --list              # list all available themes
 *   npx tsx app/frontend/scripts/import-theme.ts --search gruvbox    # search by name
 *
 * The script fetches the Windows Terminal JSON format from:
 *   https://raw.githubusercontent.com/mbadolato/iTerm2-Color-Schemes/master/windowsterminal/{name}.json
 *
 * It auto-detects dark/light category from the background luminance,
 * generates a kebab-case ID from the name, fills in cursorText and
 * selectionForeground defaults, and appends to configs/themes.json.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const THEMES_PATH = resolve(REPO_ROOT, "configs/themes.json");
const BASE_URL = "https://raw.githubusercontent.com/mbadolato/iTerm2-Color-Schemes/master/windowsterminal";
const INDEX_URL = "https://api.github.com/repos/mbadolato/iTerm2-Color-Schemes/contents/windowsterminal";

// ── Types ────────────────────────────────────────────────────────────────────

type WTTheme = {
  name: string;
  background: string;
  foreground: string;
  cursorColor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  purple: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightPurple: string;
  brightCyan: string;
  brightWhite: string;
};

type ThemeEntry = {
  id: string;
  name: string;
  category: "dark" | "light";
  source: string;
  palette: {
    foreground: string;
    background: string;
    cursorColor: string;
    cursorText: string;
    selectionBackground: string;
    selectionForeground: string;
    ansi: string[];
  };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function toKebab(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function detectCategory(bg: string): "dark" | "light" {
  return luminance(bg) < 0.5 ? "dark" : "light";
}

function convertTheme(wt: WTTheme, opts: { id?: string; category?: "dark" | "light" }): ThemeEntry {
  const category = opts.category ?? detectCategory(wt.background);
  return {
    id: opts.id ?? toKebab(wt.name),
    name: wt.name,
    category,
    source: `iterm2:${wt.name}`,
    palette: {
      foreground: wt.foreground,
      background: wt.background,
      cursorColor: wt.cursorColor,
      cursorText: wt.background,
      selectionBackground: wt.selectionBackground,
      selectionForeground: wt.foreground,
      ansi: [
        wt.black, wt.red, wt.green, wt.yellow, wt.blue, wt.purple, wt.cyan, wt.white,
        wt.brightBlack, wt.brightRed, wt.brightGreen, wt.brightYellow, wt.brightBlue, wt.brightPurple, wt.brightCyan, wt.brightWhite,
      ],
    },
  };
}

async function fetchTheme(name: string): Promise<WTTheme> {
  const url = `${BASE_URL}/${encodeURIComponent(name)}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Theme "${name}" not found at ${url} (${res.status})`);
  }
  return res.json() as Promise<WTTheme>;
}

async function listAvailableThemes(search?: string): Promise<string[]> {
  const res = await fetch(INDEX_URL);
  if (!res.ok) throw new Error(`Failed to fetch theme index (${res.status})`);
  const files: { name: string }[] = await res.json() as { name: string }[];
  let names = files
    .filter((f) => f.name.endsWith(".json"))
    .map((f) => f.name.replace(/\.json$/, ""));
  if (search) {
    const q = search.toLowerCase();
    names = names.filter((n) => n.toLowerCase().includes(q));
  }
  return names.sort();
}

function loadThemes(): ThemeEntry[] {
  return JSON.parse(readFileSync(THEMES_PATH, "utf-8")) as ThemeEntry[];
}

function saveThemes(themes: ThemeEntry[]): void {
  writeFileSync(THEMES_PATH, JSON.stringify(themes, null, 2) + "\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // --list / --search
  if (args.includes("--list") || args.includes("--search")) {
    const searchIdx = args.indexOf("--search");
    const search = searchIdx >= 0 ? args[searchIdx + 1] : undefined;
    const names = await listAvailableThemes(search);
    console.log(`${names.length} themes available${search ? ` matching "${search}"` : ""}:\n`);
    for (const name of names) {
      console.log(`  ${name}`);
    }
    return;
  }

  // Theme name is the first non-flag argument
  const themeName = args.find((a) => !a.startsWith("--"));
  if (!themeName) {
    console.error("Usage: npx tsx app/frontend/scripts/import-theme.ts <theme-name> [--id <id>] [--category dark|light]");
    console.error("       npx tsx app/frontend/scripts/import-theme.ts --list");
    console.error("       npx tsx app/frontend/scripts/import-theme.ts --search <query>");
    process.exit(1);
  }

  // Parse optional flags
  const idIdx = args.indexOf("--id");
  const catIdx = args.indexOf("--category");
  const id = idIdx >= 0 ? args[idIdx + 1] : undefined;
  const category = catIdx >= 0 ? (args[catIdx + 1] as "dark" | "light") : undefined;

  // Fetch and convert
  console.log(`Fetching "${themeName}" from iTerm2-Color-Schemes...`);
  const wt = await fetchTheme(themeName);
  const entry = convertTheme(wt, { id, category });

  // Check for duplicates
  const themes = loadThemes();
  const existing = themes.find((t) => t.id === entry.id);
  if (existing) {
    console.error(`Theme with id "${entry.id}" already exists. Use --id <different-id> to override.`);
    process.exit(1);
  }

  // Insert: dark themes before the first light theme, light themes at the end
  if (entry.category === "dark") {
    const firstLightIdx = themes.findIndex((t) => t.category === "light");
    if (firstLightIdx >= 0) {
      themes.splice(firstLightIdx, 0, entry);
    } else {
      themes.push(entry);
    }
  } else {
    themes.push(entry);
  }

  saveThemes(themes);
  console.log(`Added "${entry.name}" (${entry.id}) as ${entry.category} theme.`);
  console.log(`Source: ${entry.source}`);
  console.log(`\n${themes.length} themes total in configs/themes.json`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

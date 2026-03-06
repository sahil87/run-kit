/**
 * Input validation for user-provided names and paths.
 * Prevents potentially dangerous characters from reaching subprocess calls.
 */

import { homedir } from "node:os";
import { resolve } from "node:path";

/** Characters that are never valid in tmux session/window names. */
const FORBIDDEN_CHARS = /[;&|`$(){}[\]<>!#*?\n\r\t]/;

/** Max length for names. */
const MAX_NAME_LENGTH = 128;

/** Validate a tmux session or window name. Returns null if valid, error message if invalid. */
export function validateName(name: string, label: string): string | null {
  if (!name || name.trim().length === 0) {
    return `${label} cannot be empty`;
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `${label} exceeds maximum length of ${MAX_NAME_LENGTH} characters`;
  }
  if (FORBIDDEN_CHARS.test(name)) {
    return `${label} contains forbidden characters`;
  }
  // tmux uses colons in target syntax (session:window.pane), reject to avoid ambiguity
  if (name.includes(":") || name.includes(".")) {
    return `${label} cannot contain colons or periods`;
  }
  return null;
}

/**
 * Expand leading ~ to the server user's home directory and resolve the path.
 * Returns the expanded absolute path, or null with an error message if invalid.
 */
export function expandTilde(raw: string): { path: string; error: null } | { path: null; error: string } {
  const home = homedir();
  let expanded: string;

  if (raw.startsWith("~/") || raw === "~") {
    expanded = resolve(home, raw.slice(2) || ".");
  } else if (raw.startsWith("~")) {
    // Reject ~username syntax — only ~/path is supported
    return { path: null, error: "~user expansion is not supported; use ~/path" };
  } else if (raw.startsWith("/")) {
    expanded = resolve(raw);
  } else {
    // Bare relative path — resolve relative to $HOME
    expanded = resolve(home, raw);
  }

  // Reject .. traversal that escapes $HOME
  if (!expanded.startsWith(home + "/") && expanded !== home) {
    return { path: null, error: "Path must be under home directory" };
  }

  return { path: expanded, error: null };
}

/**
 * Sanitize a user-provided filename for safe disk storage.
 * Strips `/`, `\`, null bytes, and leading dots; replaces path separators with `-`.
 * Returns `upload` if the result is empty after sanitization.
 */
export function sanitizeFilename(name: string): string {
  let sanitized = name
    .replace(/\0/g, "")        // strip null bytes
    .replace(/[/\\]/g, "-")    // replace path separators with dash
    .replace(/^\.+/, "")       // strip leading dots
    .replace(/\.{2,}/g, "")    // strip sequences of 2+ dots (traversal remnants)
    .replace(/-{2,}/g, "-")    // collapse multiple dashes
    .replace(/^-+|-+$/g, "");  // strip leading/trailing dashes

  sanitized = sanitized.trim();
  return sanitized || "upload";
}

/** Validate a file path. Returns null if valid, error message if invalid. */
export function validatePath(path: string, label: string): string | null {
  if (!path || path.trim().length === 0) {
    return `${label} cannot be empty`;
  }
  if (path.length > 1024) {
    return `${label} exceeds maximum length`;
  }
  // Reject null bytes and newlines
  if (/[\0\n\r]/.test(path)) {
    return `${label} contains invalid characters`;
  }
  return null;
}

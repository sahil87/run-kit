/**
 * Input validation for user-provided names and paths.
 * Prevents potentially dangerous characters from reaching subprocess calls.
 */

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

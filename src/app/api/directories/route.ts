import { NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, basename, join } from "node:path";
import { expandTilde } from "@/lib/validate";

export const dynamic = "force-dynamic";

const HOME = homedir();
const FS_TIMEOUT = 5_000;

/** Replace absolute home prefix with ~/ for display. */
function tildePrefix(absPath: string): string {
  if (absPath === HOME) return "~";
  if (absPath.startsWith(HOME + "/")) {
    return "~/" + absPath.slice(HOME.length + 1);
  }
  return absPath;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const prefix = searchParams.get("prefix") ?? "";

  if (!prefix) {
    return NextResponse.json({ directories: [] });
  }

  const result = expandTilde(prefix);
  if (result.path === null) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const expanded = result.path;

  try {
    let parentDir: string;
    let filter: string;

    // If prefix ends with /, list children of that directory
    if (prefix.endsWith("/")) {
      parentDir = expanded;
      filter = "";
    } else {
      // List children of parent that start with the last segment
      parentDir = dirname(expanded);
      filter = basename(expanded).toLowerCase();
    }

    const entries = await Promise.race([
      readdir(parentDir, { withFileTypes: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), FS_TIMEOUT),
      ),
    ]);

    const directories = entries
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        if (filter && !entry.name.toLowerCase().startsWith(filter)) return false;
        // Skip hidden directories
        if (entry.name.startsWith(".")) return false;
        return true;
      })
      .map((entry) => tildePrefix(join(parentDir, entry.name)) + "/")
      .sort();

    return NextResponse.json({ directories });
  } catch (err) {
    // Non-existent directory or permission error — return empty, not 500
    if (err instanceof Error && err.message === "Timeout") {
      return NextResponse.json({ error: "Directory listing timed out" }, { status: 504 });
    }
    return NextResponse.json({ directories: [] });
  }
}

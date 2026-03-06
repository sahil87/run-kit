import { NextResponse } from "next/server";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateName, sanitizeFilename } from "@/lib/validate";
import { listWindows } from "@/lib/tmux";
import { UPLOAD_MAX_BYTES } from "@/lib/types";

export const dynamic = "force-dynamic";

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const session = formData.get("session");
    if (!session || typeof session !== "string") {
      return badRequest("Missing session field");
    }

    const sessionErr = validateName(session, "Session name");
    if (sessionErr) return badRequest(sessionErr);

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return badRequest("Missing file field");
    }

    if (file.size > UPLOAD_MAX_BYTES) {
      return badRequest("File exceeds 50MB limit");
    }

    const windowField = formData.get("window");
    let windowIndex = 0;
    if (windowField !== null) {
      const parsed = Number(windowField);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return badRequest("Invalid window index");
      }
      windowIndex = parsed;
    }

    const windows = await listWindows(session);
    if (windows.length === 0) {
      return badRequest("Session not found or has no windows");
    }

    const targetWindow = windows.find((w) => w.index === windowIndex) ?? windows[0];
    const projectRoot = targetWindow.worktreePath;

    // Ensure .uploads/ directory exists
    const uploadsDir = join(projectRoot, ".uploads");
    await mkdir(uploadsDir, { recursive: true });

    // Ensure .uploads/ is in .gitignore
    const gitignorePath = join(projectRoot, ".gitignore");
    let gitignoreContent = "";
    try {
      gitignoreContent = await readFile(gitignorePath, "utf-8");
    } catch {
      // .gitignore doesn't exist yet — will be created
    }

    if (!gitignoreContent.split("\n").some((line) => line.trim() === ".uploads/")) {
      const separator = gitignoreContent.length > 0 && !gitignoreContent.endsWith("\n") ? "\n" : "";
      await writeFile(gitignorePath, `${gitignoreContent}${separator}.uploads/\n`, "utf-8");
    }

    // Build timestamped filename
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const timestamp = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safeName = sanitizeFilename(file.name);
    const finalName = `${timestamp}-${safeName}`;

    // Write file to disk
    const filePath = join(uploadsDir, finalName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    return NextResponse.json({ ok: true, path: filePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { fetchSessions } from "@/lib/sessions";
import { createSession, createWindow, killSession, killWindow, sendKeys } from "@/lib/tmux";
import { validateName, validatePath } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessions = await fetchSessions();
    return NextResponse.json(sessions);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch sessions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (!body || typeof body.action !== "string") {
      return badRequest("Missing or invalid action");
    }

    switch (body.action) {
      case "createSession": {
        const name = String(body.name ?? "");
        const nameErr = validateName(name, "Session name");
        if (nameErr) return badRequest(nameErr);
        await createSession(name);
        break;
      }
      case "createWindow": {
        const session = String(body.session ?? "");
        const name = String(body.name ?? "");
        const cwd = body.cwd ? String(body.cwd) : process.cwd();

        const sessionErr = validateName(session, "Session name");
        if (sessionErr) return badRequest(sessionErr);
        const nameErr = validateName(name, "Window name");
        if (nameErr) return badRequest(nameErr);
        const cwdErr = validatePath(cwd, "Working directory");
        if (cwdErr) return badRequest(cwdErr);

        await createWindow(session, name, cwd);
        break;
      }
      case "killSession": {
        const session = String(body.session ?? "");
        const sessionErr = validateName(session, "Session name");
        if (sessionErr) return badRequest(sessionErr);
        await killSession(session);
        break;
      }
      case "killWindow": {
        const session = String(body.session ?? "");
        const index = Number(body.index);

        const sessionErr = validateName(session, "Session name");
        if (sessionErr) return badRequest(sessionErr);
        if (!Number.isInteger(index) || index < 0) {
          return badRequest("Invalid window index");
        }

        await killWindow(session, index);
        break;
      }
      case "sendKeys": {
        const session = String(body.session ?? "");
        const window = Number(body.window);
        const keys = String(body.keys ?? "");

        const sessionErr = validateName(session, "Session name");
        if (sessionErr) return badRequest(sessionErr);
        if (!Number.isInteger(window) || window < 0) {
          return badRequest("Invalid window index");
        }
        if (!keys) return badRequest("Keys cannot be empty");

        await sendKeys(session, window, keys);
        break;
      }
      default:
        return badRequest("Unknown action");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

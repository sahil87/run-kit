import { fetchSessions } from "@/lib/sessions";
import { DashboardClient } from "./dashboard-client";
import type { ProjectSession } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let initialSessions: ProjectSession[] = [];
  try {
    initialSessions = await fetchSessions();
  } catch {
    // Fall through with empty array
  }

  return <DashboardClient initialSessions={initialSessions} />;
}

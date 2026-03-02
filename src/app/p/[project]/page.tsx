import { fetchSessions } from "@/lib/sessions";
import { ProjectClient } from "./project-client";
import type { ProjectSession } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ project: string }>;
};

export default async function ProjectPage({ params }: Props) {
  const { project } = await params;
  let initialSessions: ProjectSession[] = [];
  try {
    initialSessions = await fetchSessions();
  } catch {
    // Fall through with empty array
  }

  const projectSession = initialSessions.find((s) => s.name === project);

  return (
    <ProjectClient
      projectName={project}
      initialWindows={projectSession?.windows ?? []}
    />
  );
}

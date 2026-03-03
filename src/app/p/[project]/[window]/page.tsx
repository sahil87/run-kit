import { config } from "@/lib/config";
import { TerminalClient } from "./terminal-client";

type Props = {
  params: Promise<{ project: string; window: string }>;
  searchParams: Promise<{ name?: string }>;
};

export default async function TerminalPage({ params, searchParams }: Props) {
  const { project, window: windowIndex } = await params;
  const { name } = await searchParams;

  return (
    <TerminalClient
      projectName={project}
      windowIndex={windowIndex}
      windowName={name ?? windowIndex}
      relayPort={config.relayPort}
    />
  );
}

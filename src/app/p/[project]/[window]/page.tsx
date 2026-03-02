import { TerminalClient } from "./terminal-client";

type Props = {
  params: Promise<{ project: string; window: string }>;
};

export default async function TerminalPage({ params }: Props) {
  const { project, window: windowIndex } = await params;

  return <TerminalClient projectName={project} windowIndex={windowIndex} />;
}

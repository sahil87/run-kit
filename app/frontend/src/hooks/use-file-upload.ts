import { useState, useCallback } from "react";
import { uploadFile } from "@/api/client";
import { useSessionContext } from "@/contexts/session-context";

export type UploadedFile = {
  path: string;
  file: File;
};

type UseFileUploadReturn = {
  /** Accepts a `FileList` (native input/drop/paste) or a plain `File[]` (e.g.
   * files handed off to the compose strip for re-homing) — both are normalized
   * via `Array.from` internally. */
  uploadFiles: (files: FileList | File[]) => Promise<UploadedFile[]>;
  uploading: boolean;
};

/**
 * useFileUpload — when `serverOverride` is provided, that server is used
 * directly (e.g., Boards mount TerminalClients with explicit per-entry
 * servers). Otherwise it falls back to the provider's `currentServer`.
 */
export function useFileUpload(
  session: string,
  windowId: string,
  serverOverride?: string,
): UseFileUploadReturn {
  const [uploading, setUploading] = useState(false);
  const { currentServer } = useSessionContext();
  const server = serverOverride ?? currentServer ?? "";
  if (!server) {
    throw new Error(
      "useFileUpload requires either serverOverride or a current-server route context",
    );
  }

  const uploadFiles = useCallback(
    async (files: FileList | File[]): Promise<UploadedFile[]> => {
      const list = Array.from(files);
      if (list.length === 0) return [];
      setUploading(true);

      const results: UploadedFile[] = [];
      try {
        for (const file of list) {
          try {
            const result = await uploadFile(server, session, file, windowId);
            if (result.ok && result.path) {
              results.push({ path: result.path, file });
            }
          } catch (err) {
            console.error("Upload error:", err);
          }
        }
      } finally {
        setUploading(false);
      }

      return results;
    },
    [server, session, windowId],
  );

  return { uploadFiles, uploading };
}

import { useState, useCallback } from "react";
import { uploadFile } from "@/api/client";
import { useSessionContext } from "@/contexts/session-context";

export type UploadedFile = {
  path: string;
  file: File;
};

type UseFileUploadReturn = {
  uploadFiles: (files: FileList) => Promise<UploadedFile[]>;
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
    async (files: FileList): Promise<UploadedFile[]> => {
      if (files.length === 0) return [];
      setUploading(true);

      const results: UploadedFile[] = [];
      try {
        for (const file of Array.from(files)) {
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

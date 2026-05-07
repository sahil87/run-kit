import { useState, useCallback, useContext } from "react";
import { uploadFile } from "@/api/client";
import { SessionContext } from "@/contexts/session-context";

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
 * directly (no SessionProvider needed). Otherwise it falls back to the
 * SessionContext server. Boards mount TerminalClients outside the per-server
 * SessionProvider, so they pass the entry's server explicitly.
 */
export function useFileUpload(
  session: string,
  windowIndex: string,
  serverOverride?: string,
): UseFileUploadReturn {
  const [uploading, setUploading] = useState(false);
  // Read context lazily — undefined when not in a SessionProvider, which is
  // valid as long as serverOverride is supplied.
  const ctx = useContext(SessionContext);
  if (!serverOverride && !ctx) {
    throw new Error(
      "useFileUpload requires either serverOverride or to be inside SessionProvider",
    );
  }
  const server = serverOverride ?? (ctx as NonNullable<typeof ctx>).server;

  const uploadFiles = useCallback(
    async (files: FileList): Promise<UploadedFile[]> => {
      if (files.length === 0) return [];
      setUploading(true);

      const results: UploadedFile[] = [];
      try {
        for (const file of Array.from(files)) {
          try {
            const result = await uploadFile(server, session, file, windowIndex);
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
    [server, session, windowIndex],
  );

  return { uploadFiles, uploading };
}

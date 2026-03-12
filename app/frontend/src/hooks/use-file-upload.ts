import { useState, useCallback } from "react";
import { uploadFile } from "@/api/client";

type UseFileUploadReturn = {
  uploadFiles: (files: FileList) => Promise<string[]>;
  uploading: boolean;
};

export function useFileUpload(session: string, windowIndex: string): UseFileUploadReturn {
  const [uploading, setUploading] = useState(false);

  const uploadFiles = useCallback(
    async (files: FileList): Promise<string[]> => {
      if (files.length === 0) return [];
      setUploading(true);

      const paths: string[] = [];
      try {
        for (const file of Array.from(files)) {
          try {
            const result = await uploadFile(session, file, windowIndex);
            if (result.ok && result.path) {
              paths.push(result.path);
            }
          } catch (err) {
            console.error("Upload error:", err);
          }
        }
      } finally {
        setUploading(false);
      }

      return paths;
    },
    [session, windowIndex],
  );

  return { uploadFiles, uploading };
}

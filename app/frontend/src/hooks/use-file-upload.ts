import { useState, useCallback } from "react";
import { uploadFile } from "@/api/client";

export type UploadedFile = {
  path: string;
  file: File;
};

type UseFileUploadReturn = {
  uploadFiles: (files: FileList) => Promise<UploadedFile[]>;
  uploading: boolean;
};

export function useFileUpload(session: string, windowIndex: string): UseFileUploadReturn {
  const [uploading, setUploading] = useState(false);

  const uploadFiles = useCallback(
    async (files: FileList): Promise<UploadedFile[]> => {
      if (files.length === 0) return [];
      setUploading(true);

      const results: UploadedFile[] = [];
      try {
        for (const file of Array.from(files)) {
          try {
            const result = await uploadFile(session, file, windowIndex);
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
    [session, windowIndex],
  );

  return { uploadFiles, uploading };
}

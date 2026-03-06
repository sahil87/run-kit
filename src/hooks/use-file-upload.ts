"use client";

import { useState, useCallback } from "react";

type UseFileUploadReturn = {
  uploadFiles: (files: FileList) => Promise<string[]>;
  uploading: boolean;
};

/**
 * Hook to upload files to the server via POST /api/upload.
 * Returns uploaded file paths and loading state.
 */
export function useFileUpload(projectName: string, windowIndex: string): UseFileUploadReturn {
  const [uploading, setUploading] = useState(false);

  const uploadFiles = useCallback(
    async (files: FileList): Promise<string[]> => {
      if (files.length === 0) return [];
      setUploading(true);

      const paths: string[] = [];
      try {
        for (const file of Array.from(files)) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("session", projectName);
          formData.append("window", windowIndex);

          const res = await fetch("/api/upload", {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          if (data.ok && data.path) {
            paths.push(data.path);
          }
        }
      } finally {
        setUploading(false);
      }

      return paths;
    },
    [projectName, windowIndex],
  );

  return { uploadFiles, uploading };
}

import { useState, useCallback } from "react";

type UseFileUploadReturn = {
  uploadFiles: (files: FileList) => Promise<string[]>;
  uploading: boolean;
};

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
          let data: Record<string, unknown> | null = null;
          try {
            data = await res.json();
          } catch {
            // Non-JSON response
          }
          if (!res.ok) {
            const msg = (data?.error as string) ?? `Upload failed (${res.status})`;
            console.error("Upload error:", msg);
            continue;
          }
          if (data?.ok && data?.path) {
            paths.push(data.path as string);
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

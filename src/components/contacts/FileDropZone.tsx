import { useRef, useState } from "react";
import { useContactsStore } from "@/stores/contacts.store";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { sendContactFile } from "@/matrix/events";

interface Props {
  contactId: string;
  dataRoomId: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileDropZone({ contactId, dataRoomId }: Props) {
  const client = useMatrixClient();
  const files = useContactsStore((s) => s.files[contactId] ?? []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const uploadFile = async (file: File) => {
    setUploading((prev) => [...prev, file.name]);
    setErrors((prev) => prev.filter((e) => !e.startsWith(file.name)));
    try {
      await sendContactFile(client, dataRoomId, contactId, file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors((prev) => [...prev, `${file.name}: ${msg}`]);
    } finally {
      setUploading((prev) => prev.filter((n) => n !== file.name));
    }
  };

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    for (const file of Array.from(fileList)) {
      uploadFile(file);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const handleDownload = async (mxcUri: string, filename: string) => {
    // Modern homeservers (Matrix spec ≥ v1.11) require an Authorization header
    // for media downloads. A plain <a href> can't send headers, so we fetch
    // the file via the Matrix client and serve it as a blob URL instead.
    const url = client.mxcUrlToHttp(
      mxcUri,
      undefined, undefined, undefined, undefined, undefined,
      true, // useAuthentication → /_matrix/client/v1/media/download/...
    );
    if (!url) return;
    try {
      const token = client.getAccessToken();
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors((prev) => [...prev, `Download failed for ${filename}: ${msg}`]);
    }
  };

  return (
    <div className="space-y-3">
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-blue-400 bg-blue-50"
            : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
        }`}
      >
        <p className="text-sm text-gray-500">
          Drag files here or{" "}
          <span className="text-blue-600 underline">click to browse</span>
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {uploading.length > 0 && (
        <div className="space-y-1">
          {uploading.map((name) => (
            <div key={name} className="flex items-center gap-2 text-sm text-gray-500">
              <svg
                className="animate-spin h-4 w-4 text-blue-500 shrink-0"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              <span className="truncate">Uploading {name}…</span>
            </div>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <div className="space-y-1">
          {errors.map((err, i) => (
            <p key={i} className="text-xs text-red-600">
              {err}
            </p>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 overflow-hidden">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between px-3 py-2 bg-white hover:bg-gray-50">
              <div className="flex items-center gap-2 min-w-0">
                <svg
                  className="h-4 w-4 text-gray-400 shrink-0"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
                <span className="text-sm text-gray-800 truncate">{f.filename}</span>
                <span className="text-xs text-gray-400 shrink-0">{formatBytes(f.size)}</span>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleDownload(f.mxcUri, f.filename); }}
                className="text-xs text-blue-600 hover:underline shrink-0 ml-2"
              >
                Download
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

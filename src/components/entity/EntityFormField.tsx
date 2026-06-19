import { useRef, useState, useEffect } from "react";
import type { UseFormRegister, Control, FieldErrors, FieldValues } from "react-hook-form";
import { useController } from "react-hook-form";
import type { FieldDefinition } from "@/entities/types";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { RelationField } from "./RelationField";

interface Props {
  field: FieldDefinition;
  register: UseFormRegister<FieldValues>;
  control: Control<FieldValues>;
  errors: FieldErrors<FieldValues>;
}

function AvatarField({ field, control }: Pick<Props, "field" | "control">) {
  const client = useMatrixClient();
  const { field: controllerField } = useController({
    name: field.name,
    control,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);

  const avatarMxcUri = controllerField.value as string | undefined;

  useEffect(() => {
    if (!avatarMxcUri) {
      setPreviewBlobUrl(null);
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    const load = async () => {
      const url = client.mxcUrlToHttp(
        avatarMxcUri,
        undefined, undefined, undefined, undefined, undefined,
        true,
      );
      if (!url) return;
      try {
        const token = client.getAccessToken();
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setPreviewBlobUrl(createdUrl);
      } catch {
        // silently ignore preview load failures
      }
    };
    load();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [avatarMxcUri, client]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadState("uploading");
    setUploadError(null);
    try {
      const result = await client.uploadContent(file);
      controllerField.onChange(result.content_uri);
      setUploadState("idle");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadError(msg);
      setUploadState("error");
    }
  };

  const handleDownloadAvatar = async () => {
    if (!avatarMxcUri) return;
    const url = client.mxcUrlToHttp(
      avatarMxcUri,
      undefined, undefined, undefined, undefined, undefined,
      true,
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
      a.download = "avatar";
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadError(`Download failed: ${msg}`);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-200 shrink-0 flex items-center justify-center">
        {previewBlobUrl ? (
          <img src={previewBlobUrl} alt="Avatar" className="w-full h-full object-cover" />
        ) : (
          <svg className="w-12 h-12 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
          </svg>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={uploadState === "uploading"}
            onClick={() => fileInputRef.current?.click()}
            className="text-sm text-blue-600 hover:underline disabled:opacity-50"
          >
            {avatarMxcUri ? "Replace" : "Upload image"}
          </button>
          {avatarMxcUri && (
            <button type="button" onClick={handleDownloadAvatar} className="text-sm text-gray-500 hover:underline">
              Download
            </button>
          )}
          {uploadState === "uploading" && (
            <svg className="animate-spin h-4 w-4 text-blue-500 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
        </div>
        {uploadState === "error" && uploadError && (
          <p className="text-xs text-red-600">{uploadError}</p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={handleAvatarChange}
        />
      </div>
    </div>
  );
}

function RelationFormField({ field, control }: Pick<Props, "field" | "control">) {
  const { field: controllerField } = useController({
    name: field.name,
    control,
    defaultValue: [],
  });

  return (
    <RelationField
      field={field}
      value={(controllerField.value as string[]) ?? []}
      onChange={controllerField.onChange}
    />
  );
}

export function EntityFormField({ field, register, control, errors }: Props) {
  const error = errors[field.name];
  const errorMessage = error?.message as string | undefined;

  const inputClass =
    "w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500";

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {field.label}
        {field.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      {field.type === "avatar" ? (
        <AvatarField field={field} control={control} />
      ) : field.type === "relation" ? (
        <RelationFormField field={field} control={control} />
      ) : field.type === "select" ? (
        <select {...register(field.name)} className={inputClass}>
          <option value="">Select {field.label.toLowerCase()}</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : field.type === "color" ? (
        <input
          {...register(field.name)}
          type="color"
          className="h-9 w-16 border border-gray-300 rounded px-1 py-1 cursor-pointer"
        />
      ) : (
        <input
          {...register(field.name)}
          type={field.type}
          className={inputClass}
        />
      )}

      {errorMessage && (
        <p className="text-red-500 text-xs mt-1">{errorMessage}</p>
      )}
    </div>
  );
}

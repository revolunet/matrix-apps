import { useRef, useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ContactFormSchema,
  type ContactFormData,
} from "@/schemas/contact.schema";
import { useMatrixClient } from "@/hooks/useMatrixClient";

interface Props {
  defaultValues?: Partial<ContactFormData>;
  onSubmit: (data: ContactFormData) => Promise<void>;
  submitLabel?: string;
}

export function ContactForm({
  defaultValues,
  onSubmit,
  submitLabel = "Save",
}: Props) {
  const client = useMatrixClient();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({
    resolver: zodResolver(ContactFormSchema),
    defaultValues,
  });

  const avatarMxcUri = watch("avatarMxcUri");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);

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
    // Reset input so the same file can be re-selected after removal
    e.target.value = "";
    setUploadState("uploading");
    setUploadError(null);
    try {
      const result = await client.uploadContent(file);
      const mxcUri = result.content_uri;
      setValue("avatarMxcUri", mxcUri, { shouldDirty: true });
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-w-md">
      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-200 shrink-0 flex items-center justify-center">
          {previewBlobUrl ? (
            <img
              src={previewBlobUrl}
              alt="Avatar"
              className="w-full h-full object-cover"
            />
          ) : (
            <svg
              className="w-12 h-12 text-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
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
              <button
                type="button"
                onClick={handleDownloadAvatar}
                className="text-sm text-gray-500 hover:underline"
              >
                Download
              </button>
            )}
            {uploadState === "uploading" && (
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

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Full Name
        </label>
        <input
          {...register("fullname")}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          placeholder="Jane Doe"
        />
        {errors.fullname && (
          <p className="text-red-500 text-xs mt-1">{errors.fullname.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Email
        </label>
        <input
          {...register("email")}
          type="email"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          placeholder="jane@example.com"
        />
        {errors.email && (
          <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Gender
        </label>
        <select
          {...register("gender")}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">Select gender</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
          <option value="prefer_not_to_say">Prefer not to say</option>
        </select>
        {errors.gender && (
          <p className="text-red-500 text-xs mt-1">{errors.gender.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Birthdate
        </label>
        <input
          {...register("birthdate")}
          type="date"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
        />
        {errors.birthdate && (
          <p className="text-red-500 text-xs mt-1">{errors.birthdate.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Preferred Color
        </label>
        <input
          {...register("preferred_color")}
          type="color"
          className="h-9 w-16 border border-gray-300 rounded px-1 py-1 cursor-pointer"
        />
        {errors.preferred_color && (
          <p className="text-red-500 text-xs mt-1">{errors.preferred_color.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-black text-white text-sm px-4 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
      >
        {isSubmitting ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}

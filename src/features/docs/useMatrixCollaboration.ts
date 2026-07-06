import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { MatrixEventEvent } from "matrix-js-sdk";
import type { MatrixClient } from "matrix-js-sdk";
import { useCreateBlockNote } from "@blocknote/react";
import { useAuthStore } from "@/stores/auth.store";
import { MatrixYjsProvider } from "@/matrix/yjs-matrix-provider";
import {
  encryptAttachment,
  decryptAttachment,
  type EncryptedFileInfo,
} from "@/matrix/attachment-crypto";
import { docsBlockNoteSchema, docsDictionary } from "./blocknote-schema";

// Cache blob URLs per stored reference (mxc:// URI, or our encrypted-ref
// string) — avoids re-fetching/re-decrypting on every render
const blobUrlCache = new Map<string, string>();

/**
 * Fetches Matrix media with auth headers and returns a local blob URL.
 * Tries the authenticated endpoint first (MSC3916), falls back to legacy.
 *
 * Only used for `mxc://` references stored before attachment encryption was
 * introduced — new uploads always go through fetchAndDecryptAttachment below.
 */
async function fetchMxcAsBlob(
  mxcUrl: string,
  httpUrl: string,
  accessToken: string,
): Promise<string> {
  const cached = blobUrlCache.get(mxcUrl);
  if (cached) return cached;

  // Authenticated fetch (required by Matrix 1.11+)
  const tryFetch = async (headers?: HeadersInit) => {
    const r = await fetch(httpUrl, { headers });
    return r.ok ? r : null;
  };

  try {
    const response =
      (await tryFetch({ Authorization: `Bearer ${accessToken}` })) ??
      (await tryFetch());

    if (!response) return httpUrl; // both failed — return raw HTTP URL as last resort

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    blobUrlCache.set(mxcUrl, objectUrl);
    return objectUrl;
  } catch {
    return httpUrl;
  }
}

// Marks a stored BlockNote file url as one of our encrypted attachments,
// distinguishing it from a bare (legacy, unencrypted) mxc:// reference.
const ENCRYPTED_REF_PREFIX = "matrix-enc:";

interface StoredEncryptedFile extends EncryptedFileInfo {
  url: string; // mxc:// pointer to the ciphertext blob
  mimetype: string;
}

function encodeEncryptedRef(file: StoredEncryptedFile): string {
  return ENCRYPTED_REF_PREFIX + encodeURIComponent(JSON.stringify(file));
}

function decodeEncryptedRef(ref: string): StoredEncryptedFile | null {
  if (!ref.startsWith(ENCRYPTED_REF_PREFIX)) return null;
  try {
    return JSON.parse(decodeURIComponent(ref.slice(ENCRYPTED_REF_PREFIX.length)));
  } catch {
    return null;
  }
}

/**
 * Downloads the ciphertext blob referenced by an encrypted attachment ref,
 * decrypts it client-side, and returns a local blob URL. The media repo only
 * ever sees/stores the ciphertext — the key/iv travel solely inside the
 * E2E-encrypted room event (see attachment-crypto.ts).
 */
async function fetchAndDecryptAttachment(
  ref: string,
  file: StoredEncryptedFile,
  client: MatrixClient,
): Promise<string> {
  const cached = blobUrlCache.get(ref);
  if (cached) return cached;

  const httpUrl = client.mxcUrlToHttp(
    file.url, undefined, undefined, undefined, undefined, undefined, true,
  );
  if (!httpUrl) throw new Error("Could not resolve attachment media URL");

  const accessToken = client.getAccessToken() ?? "";
  const tryFetch = async (headers?: HeadersInit) => {
    const r = await fetch(httpUrl, { headers });
    return r.ok ? r : null;
  };
  const response =
    (await tryFetch({ Authorization: `Bearer ${accessToken}` })) ?? (await tryFetch());
  if (!response) throw new Error("Failed to download attachment ciphertext");

  const ciphertext = await response.arrayBuffer();
  const plaintext = await decryptAttachment(ciphertext, file);
  const blob = new Blob([plaintext], { type: file.mimetype || "application/octet-stream" });
  const objectUrl = URL.createObjectURL(blob);
  blobUrlCache.set(ref, objectUrl);
  return objectUrl;
}

function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

/**
 * Creates a BlockNote editor backed by Yjs, synced over a Matrix room.
 * The component using this hook should be keyed on `roomId` to guarantee
 * a fresh provider/Y.Doc on each document change.
 */
export type DocLoadState = "loading" | "loaded" | "error";

export function useMatrixCollaboration(roomId: string) {
  const client = useAuthStore((s) => s.client);
  const userId = useAuthStore((s) => s.userId) ?? "Anonymous";

  // Y.Doc lives for the lifetime of this component instance (keyed on roomId).
  // We intentionally do NOT destroy it in the effect cleanup so that React
  // Strict Mode's double-invoke (cleanup → remount) doesn't invalidate the
  // fragment already captured by useCreateBlockNote below.
  const ydocRef = useRef<Y.Doc | null>(null);
  if (!ydocRef.current) {
    ydocRef.current = new Y.Doc();
  }

  // Holds the *currently active* provider — created fresh inside the effect
  // so Strict Mode's cleanup/remount cycle always gets a non-destroyed instance.
  const providerRef = useRef<MatrixYjsProvider | null>(null);

  const [loadState, setLoadState] = useState<DocLoadState>("loading");
  // Tracks unsaved local edits, separately from loadState (which only covers
  // the initial history replay) — see MatrixYjsProvider.onSyncStateChange.
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (!client) return;
    const ydoc = ydocRef.current!;

    // Create a fresh provider on every effect invocation (handles Strict Mode
    // double-invoke: the old provider is destroyed by cleanup, this creates a
    // replacement with its own un-destroyed onYjsUpdate listener on the ydoc).
    const provider = new MatrixYjsProvider(ydoc, roomId, client);
    providerRef.current = provider;
    setIsSyncing(provider.isSyncing());
    provider.onSyncStateChange = setIsSyncing;

    provider.awareness.setLocalStateField("user", {
      name: userId,
      color: getUserColor(userId),
    });

    const onDecrypted = provider.handleMatrixEvent;
    client.on(MatrixEventEvent.Decrypted, onDecrypted);

    // Editing must not be allowed to start until this resolves — the caller
    // keeps the editor unmounted while loadState is "loading" (see
    // DocEditorPage). On failure we surface "error" rather than falling back
    // to "loaded", since silently unlocking editing on top of a doc that may
    // only be partially restored (e.g. a corrupt update mid-replay) risks
    // persisting further changes on top of a broken merge.
    provider
      .load()
      .then(() => setLoadState("loaded"))
      .catch((err) => {
        console.warn("[docs] failed to load document:", err);
        setLoadState("error");
      });

    return () => {
      client.off(MatrixEventEvent.Decrypted, onDecrypted);
      provider.onSyncStateChange = null;
      providerRef.current = null;
      provider.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ydoc = ydocRef.current!;

  const editor = useCreateBlockNote(
    {
      schema: docsBlockNoteSchema,
      dictionary: docsDictionary,
      collaboration: {
        // providerRef.current is null on the very first render (before the
        // effect fires). Awareness/cursors won't work for that brief window,
        // but content sync via the shared fragment is unaffected.
        provider: providerRef.current ?? undefined,
        fragment: ydoc.getXmlFragment("document-store"),
        user: { name: userId, color: getUserColor(userId) },
      },
      // Encrypt client-side (AES-256-CTR) before it ever leaves the browser,
      // then upload only the ciphertext to Matrix — the media repo never
      // sees plaintext file bytes. The resulting ref (mxc:// pointer + key/iv
      // + mimetype) is what gets stored in Yjs, so it only ever travels
      // inside E2E-encrypted room events, same as the rest of the doc content.
      uploadFile: client
        ? async (file: File) => {
            const data = await file.arrayBuffer();
            const { ciphertext, info } = await encryptAttachment(data);
            // includeFilename: false — don't leak the original filename to the
            // (untrusted) media repo alongside the ciphertext.
            const { content_uri } = await client.uploadContent(ciphertext, {
              type: "application/octet-stream",
              includeFilename: false,
            });
            const stored: StoredEncryptedFile = {
              ...info,
              url: content_uri,
              mimetype: file.type || "application/octet-stream",
            };
            const ref = encodeEncryptedRef(stored);
            // Pre-warm the cache — resolveFileUrl will hit it synchronously
            void fetchAndDecryptAttachment(ref, stored, client).catch(() => {});
            return ref;
          }
        : undefined,
      // Called by BlockNote before rendering any file URL — decrypt our
      // encrypted refs, or fall back to a plain authenticated fetch for
      // mxc:// URIs stored before attachment encryption was introduced.
      resolveFileUrl: client
        ? async (url: string) => {
            const stored = decodeEncryptedRef(url);
            if (stored) return fetchAndDecryptAttachment(url, stored, client);

            if (!url.startsWith("mxc://")) return url;
            const httpUrl = client.mxcUrlToHttp(
              url, undefined, undefined, undefined, undefined, undefined, true,
            );
            if (!httpUrl) return url;
            return fetchMxcAsBlob(url, httpUrl, client.getAccessToken() ?? "");
          }
        : undefined,
    },
    [],
  );

  return { editor, loadState, isSyncing };
}

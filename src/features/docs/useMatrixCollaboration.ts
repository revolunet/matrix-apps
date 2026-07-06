import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { MatrixEventEvent } from "matrix-js-sdk";
import { useCreateBlockNote } from "@blocknote/react";
import { useAuthStore } from "@/stores/auth.store";
import { MatrixYjsProvider } from "@/matrix/yjs-matrix-provider";
import type { BlockNoteEditor } from "@blocknote/core";

// Cache blob URLs per mxc:// URI — avoids re-fetching on every render
const blobUrlCache = new Map<string, string>();

/**
 * Fetches Matrix media with auth headers and returns a local blob URL.
 * Tries the authenticated endpoint first (MSC3916), falls back to legacy.
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

export function useMatrixCollaboration(roomId: string): {
  editor: BlockNoteEditor;
  loadState: DocLoadState;
} {
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

  useEffect(() => {
    if (!client) return;
    const ydoc = ydocRef.current!;

    // Create a fresh provider on every effect invocation (handles Strict Mode
    // double-invoke: the old provider is destroyed by cleanup, this creates a
    // replacement with its own un-destroyed onYjsUpdate listener on the ydoc).
    const provider = new MatrixYjsProvider(ydoc, roomId, client);
    providerRef.current = provider;

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
      providerRef.current = null;
      provider.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ydoc = ydocRef.current!;

  const editor = useCreateBlockNote(
    {
      collaboration: {
        // providerRef.current is null on the very first render (before the
        // effect fires). Awareness/cursors won't work for that brief window,
        // but content sync via the shared fragment is unaffected.
        provider: providerRef.current ?? undefined,
        fragment: ydoc.getXmlFragment("document-store"),
        user: { name: userId, color: getUserColor(userId) },
      },
      // Upload to Matrix, then immediately download as blob so it's cached
      // before BlockNote tries to display it. The mxc:// URI is what gets
      // stored in Yjs so all collaborators share the same stable reference.
      uploadFile: client
        ? async (file: File) => {
            const { content_uri } = await client.uploadContent(file);
            // useAuthentication=true → /_matrix/client/v1/media/download/ (Matrix 1.11+)
            // so the subsequent fetch with the Bearer token actually succeeds on
            // servers like matrix.org that have disabled the unauthenticated endpoint.
            const httpUrl = client.mxcUrlToHttp(
              content_uri, undefined, undefined, undefined, undefined, undefined, true,
            );
            if (httpUrl) {
              // Pre-warm the cache — resolveFileUrl will hit it synchronously
              void fetchMxcAsBlob(content_uri, httpUrl, client.getAccessToken() ?? "");
            }
            return content_uri;
          }
        : undefined,
      // Called by BlockNote before rendering any file URL — convert mxc:// → blob URL
      resolveFileUrl: client
        ? async (url: string) => {
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

  return { editor, loadState };
}

import "@blocknote/mantine/style.css";

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import { SuggestionMenuController } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { MantineProvider } from "@mantine/core";
import { useDocsStore } from "@/stores/docs.store";
import { useAuthStore } from "@/stores/auth.store";
import {
  useMatrixCollaboration,
  type DocLoadState,
} from "./useMatrixCollaboration";
import { getDocsSlashMenuItems } from "./blocknote-schema";
import { DocCommentsSidebar } from "./DocCommentsSidebar";
import { DocShareDialog } from "./DocShareDialog";
import { useDocComments } from "./useDocComments";

function DocLoadStatus({
  loadState,
  isSyncing,
  isReceiving,
}: {
  loadState: DocLoadState;
  isSyncing: boolean;
  isReceiving: boolean;
}) {
  if (loadState === "loading") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-gray-400">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
        Syncing…
      </span>
    );
  }
  if (loadState === "error") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-500">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        Failed to sync
      </span>
    );
  }
  // loadState === "loaded" only means the initial history replay finished —
  // it says nothing about edits made since, so "Synced" also waits on:
  // - isReceiving: a remote revision is known to exist (a live event
  //   arrived) but hasn't finished decrypting/applying yet — see
  //   MatrixYjsProvider.onReceivingStateChange. Checked first since a doc
  //   that's still catching up on someone else's edit isn't "Synced" even
  //   if this client has nothing of its own to send.
  // - isSyncing: this client has local changes not yet confirmed persisted
  //   to Matrix — see MatrixYjsProvider.onSyncStateChange.
  if (isReceiving) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-amber-600">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        Updating…
      </span>
    );
  }
  if (isSyncing) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-amber-600">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        Saving…
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-green-600">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      Synced
    </span>
  );
}

function DocEditorInner({ docId, roomId }: { docId: string; roomId: string }) {
  const client = useAuthStore((s) => s.client)!;
  const doc = useDocsStore(
    (s) =>
      s.docs.find((d) => d.docId === docId) ??
      s.sharedDocs.find((d) => d.docId === docId),
  );
  const isShared = useDocsStore((s) =>
    s.sharedDocs.some((d) => d.docId === docId),
  );
  const renameDoc = useDocsStore((s) => s.renameDoc);
  const [showComments, setShowComments] = useState(false);
  const [titleValue, setTitleValue] = useState(doc?.title ?? "Untitled");
  // Tracks whether the title input is mid-edit so the sync effect below
  // doesn't clobber unsaved keystrokes when a remote rename arrives.
  const titleFocusedRef = useRef(false);

  // Subscribed regardless of whether the sidebar is open, so the header
  // button can flag incoming comments even while it's closed.
  const comments = useDocComments(client, roomId);
  const [seenCount, setSeenCount] = useState(comments.length);
  const hasUnseenComments = !showComments && comments.length > seenCount;

  const toggleComments = () => {
    setShowComments((v) => {
      const next = !v;
      if (next) setSeenCount(comments.length);
      return next;
    });
  };

  // Keyed on roomId — fresh Y.Doc + provider per room
  const { editor, loadState, isSyncing, isReceiving } = useMatrixCollaboration(roomId);

  // doc.title only reflects a remote rename (e.g. the owner renaming from
  // another session, or a collaborator's live-refreshed shared-doc state) —
  // titleValue is local state that otherwise only ever gets set once, at
  // mount, and would silently go stale.
  const docTitle = doc?.title;
  useEffect(() => {
    if (!titleFocusedRef.current && docTitle !== undefined) {
      setTitleValue(docTitle);
    }
  }, [docTitle]);

  if (!doc) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Document not found
      </div>
    );
  }

  const handleTitleBlur = () => {
    titleFocusedRef.current = false;
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== doc.title) {
      renameDoc(client, doc.docId, trimmed);
    }
  };

  return (
    <div className="flex flex-1 min-w-0 h-full overflow-hidden">
      {/* Main editor area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 flex-none">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg select-none">📄</span>
            <input
              value={titleValue}
              readOnly={isShared}
              onChange={(e) => setTitleValue(e.target.value)}
              onFocus={() => (titleFocusedRef.current = true)}
              onBlur={handleTitleBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className={`text-sm font-medium text-gray-800 bg-transparent border-none outline-none px-1 py-0.5 rounded min-w-0 max-w-xs ${isShared ? "cursor-default" : "hover:bg-gray-50 focus:bg-gray-50"}`}
            />
          </div>
          <div className="flex items-center gap-2 flex-none">
            <DocLoadStatus loadState={loadState} isSyncing={isSyncing} isReceiving={isReceiving} />
            <DocShareDialog docId={docId} roomId={roomId} />
            <button
              onClick={toggleComments}
              className={`relative text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                showComments
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-gray-200 text-gray-600 hover:border-gray-400"
              }`}
            >
              💬 Comments
              {hasUnseenComments && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-y-auto">
          <MantineProvider>
            <div className="max-w-3xl mx-auto px-4 py-8">
              <h1
                className="text-3xl font-bold text-gray-900 mb-6 px-[54px] outline-none"
                contentEditable={!isShared}
                suppressContentEditableWarning
                onBlur={(e) => {
                  if (isShared) return;
                  const t = e.currentTarget.textContent?.trim() ?? "";
                  if (t && t !== doc.title) {
                    setTitleValue(t);
                    renameDoc(client, doc.docId, t);
                  }
                }}
              >
                {doc.title}
              </h1>
              {loadState === "loaded" ? (
                <BlockNoteView
                  editor={editor}
                  theme="light"
                  className="min-h-64"
                  slashMenu={false}
                >
                  <SuggestionMenuController
                    triggerCharacter="/"
                    getItems={async (query) =>
                      filterSuggestionItems(getDocsSlashMenuItems(editor), query)
                    }
                  />
                </BlockNoteView>
              ) : loadState === "error" ? (
                // Editing stays blocked here rather than falling back to an
                // empty editor — typing on top of a doc that may only be
                // partially restored risks persisting further changes onto a
                // broken merge.
                <div className="px-[54px] py-6">
                  <p className="text-sm text-red-500 mb-3">
                    Couldn't load this document's content.
                  </p>
                  <button
                    onClick={() => window.location.reload()}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="space-y-3 px-[54px]">
                  {[80, 60, 70, 40].map((w, i) => (
                    <div
                      key={i}
                      className="h-4 bg-gray-100 rounded animate-pulse"
                      style={{ width: `${w}%` }}
                    />
                  ))}
                </div>
              )}
            </div>
          </MantineProvider>
        </div>
      </div>

      {/* Comments sidebar */}
      {showComments && doc && (
        <DocCommentsSidebar
          doc={doc}
          comments={comments}
          onClose={() => setShowComments(false)}
        />
      )}
    </div>
  );
}

function CreatingState({ title }: { title: string }) {
  return (
    <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-100">
        <span className="text-lg select-none">📄</span>
        <span className="text-sm font-medium text-gray-800">{title}</span>
        <span className="text-xs text-gray-400 animate-pulse ml-2">
          Setting up encrypted room…
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="h-9 w-48 bg-gray-100 rounded animate-pulse mb-8 mx-[54px]" />
          <div className="space-y-3 px-[54px]">
            {[80, 60, 70, 40].map((w, i) => (
              <div
                key={i}
                className="h-4 bg-gray-100 rounded animate-pulse"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DocEditorPage() {
  const { docId } = useParams<{ docId: string }>();
  const doc = useDocsStore(
    (s) =>
      s.docs.find((d) => d.docId === docId) ??
      s.sharedDocs.find((d) => d.docId === docId),
  );

  if (!docId) return null;

  if (!doc) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Document not found
      </div>
    );
  }

  // Show a skeleton while the Matrix room is still being created
  if (!doc.roomId) {
    return <CreatingState title={doc.title} />;
  }

  // Key on roomId so the Y.Doc + provider remount cleanly on each document
  return <DocEditorInner key={doc.roomId} docId={docId} roomId={doc.roomId} />;
}

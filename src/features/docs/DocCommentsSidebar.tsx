import { useState } from "react";
import { useAuthStore } from "@/stores/auth.store";
import type { DocIndexEntry } from "@/matrix/docs-matrix";

interface Comment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

function extractComments(
  client: ReturnType<typeof useAuthStore>["client"],
  roomId: string,
): Comment[] {
  if (!client) return [];
  const room = client.getRoom(roomId);
  if (!room) return [];
  const events = room.getLiveTimeline().getEvents();
  const comments: Comment[] = [];
  for (const event of events) {
    if (event.getType() !== "m.room.message") continue;
    if (event.isBeingDecrypted() || event.isDecryptionFailure()) continue;
    const content = event.getContent() as {
      msgtype?: string;
      body?: string;
      doc_comment?: boolean;
    };
    if (content.msgtype !== "m.text" || !content.doc_comment) continue;
    const id = event.getId();
    const authorId = event.getSender();
    if (!id || !authorId || !content.body) continue;
    comments.push({
      id,
      authorId,
      body: content.body,
      createdAt: new Date(event.getTs()).toISOString(),
    });
  }
  return comments;
}

interface Props {
  doc: DocIndexEntry;
  onClose: () => void;
}

export function DocCommentsSidebar({ doc, onClose }: Props) {
  const client = useAuthStore((s) => s.client);
  const userId = useAuthStore((s) => s.userId);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const comments = extractComments(client, doc.roomId);

  const handleSend = async () => {
    const trimmed = body.trim();
    if (!trimmed || !client) return;
    setSending(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any).sendEvent(doc.roomId, "m.room.message", {
        msgtype: "m.text",
        body: trimmed,
        doc_comment: true,
        doc_id: doc.docId,
      });
      setBody("");
    } catch (err) {
      console.warn("[comments] failed to send:", err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full border-l border-gray-200 bg-white w-72">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-800">Comments</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-700 text-lg"
          aria-label="Close comments"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {comments.length === 0 ? (
          <p className="text-xs text-gray-400 text-center mt-8">
            No comments yet
          </p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-gray-700 truncate">
                  {c.authorId === userId ? "You" : c.authorId.split(":")[0].replace("@", "")}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(c.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.body}</p>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t border-gray-100">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Add a comment…"
          rows={3}
          className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg resize-none outline-none focus:border-blue-400"
        />
        <button
          onClick={handleSend}
          disabled={!body.trim() || sending}
          className="mt-2 w-full text-sm py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? "Sending…" : "Comment"}
        </button>
      </div>
    </div>
  );
}

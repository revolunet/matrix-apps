import { useEffect, useRef, useState } from "react";
import { RoomMemberEvent } from "matrix-js-sdk";
import type { MatrixEvent, RoomMember } from "matrix-js-sdk";
import { useAuthStore } from "@/stores/auth.store";
import { useDocsStore } from "@/stores/docs.store";

interface Props {
  docId: string;
  roomId: string;
}

export function DocShareDialog({ docId, roomId }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const client = useAuthStore((s) => s.client)!;
  const userId = useAuthStore((s) => s.userId);
  const getDescendantRoomIds = useDocsStore((s) => s.getDescendantRoomIds);

  const [matrixUserId, setMatrixUserId] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareWarning, setShareWarning] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [members, setMembers] = useState<RoomMember[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const refreshMembers = () => {
    const room = client.getRoom(roomId);
    if (!room) return;
    setMembers(
      room
        .getMembers()
        .filter(
          (m) =>
            m.userId !== userId &&
            (m.membership === "join" || m.membership === "invite"),
        ),
    );
  };

  useEffect(() => {
    refreshMembers();
    const onMembership = (_event: MatrixEvent, member: RoomMember) => {
      if (member.roomId === roomId) refreshMembers();
    };
    client.on(RoomMemberEvent.Membership, onMembership);
    return () => client.off(RoomMemberEvent.Membership, onMembership);
  }, [client, roomId, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = () => {
    setMatrixUserId("");
    setShareError(null);
    setShareWarning(null);
    setSuccess(false);
    setRemoveError(null);
    refreshMembers();
    dialogRef.current?.showModal();
  };

  const close = () => dialogRef.current?.close();

  const handleShare = async () => {
    const target = matrixUserId.trim();
    if (!target) return;
    setSharing(true);
    setShareError(null);
    setShareWarning(null);
    setSuccess(false);
    try {
      await client.invite(roomId, target);

      // Sub-docs are their own independent Matrix rooms — sharing the
      // parent doesn't grant access to them, so fan the invite out to every
      // descendant too. Skip rooms the target is already in to avoid
      // "already in room" failures cluttering a routine re-share.
      const descendantRoomIds = getDescendantRoomIds(docId).filter((rid) => {
        const membership = client.getRoom(rid)?.getMember(target)?.membership;
        return membership !== "join" && membership !== "invite";
      });
      const results = await Promise.allSettled(
        descendantRoomIds.map((rid) => client.invite(rid, target)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        setShareWarning(`Shared, but failed to share ${failed} sub-document(s)`);
      }

      setSuccess(true);
      setMatrixUserId("");
      refreshMembers();
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Failed to invite user");
    } finally {
      setSharing(false);
    }
  };

  const handleRemove = async (targetUserId: string) => {
    if (!confirm(`Remove ${targetUserId} from this document and its sub-documents?`)) return;
    setRemoving(targetUserId);
    setRemoveError(null);
    try {
      await client.kick(roomId, targetUserId);

      // Mirror handleShare's fan-out: leaving someone with access to
      // sub-docs after they've been removed from the parent would be a
      // silent access leak, not a feature gap.
      const descendantRoomIds = getDescendantRoomIds(docId).filter((rid) => {
        const membership = client.getRoom(rid)?.getMember(targetUserId)?.membership;
        return membership === "join" || membership === "invite";
      });
      const results = await Promise.allSettled(
        descendantRoomIds.map((rid) => client.kick(rid, targetUserId)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        setRemoveError(`Removed, but failed to remove from ${failed} sub-document(s)`);
      }
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Failed to remove user");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <>
      <button
        onClick={open}
        className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400 transition-colors"
      >
        Share
      </button>

      <dialog
        ref={dialogRef}
        className="rounded-xl p-6 w-full max-w-sm shadow-xl backdrop:bg-black/40"
      >
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Share document
        </h2>

        {/* Invite input */}
        <div className="space-y-3 mb-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Matrix User ID
            </label>
            <input
              type="text"
              value={matrixUserId}
              onChange={(e) => setMatrixUserId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleShare();
              }}
              placeholder="@alice:matrix.org"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
          </div>

          {shareError && <p className="text-xs text-red-500">{shareError}</p>}
          {shareWarning && (
            <p className="text-xs text-amber-600">{shareWarning}</p>
          )}
          {success && (
            <p className="text-xs text-green-600">Invitation sent ✓</p>
          )}

          <button
            onClick={handleShare}
            disabled={sharing || !matrixUserId.trim()}
            className="w-full bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sharing ? "Inviting…" : "Invite"}
          </button>
        </div>

        {/* Current members */}
        {members.length > 0 && (
          <div className="border-t border-gray-100 pt-4 mb-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Shared with
            </h3>
            {removeError && (
              <p className="text-xs text-red-500 mb-2">{removeError}</p>
            )}
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-gray-800 flex-1 truncate text-xs">
                    {m.userId}
                  </span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                      m.membership === "join"
                        ? "bg-green-100 text-green-700"
                        : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {m.membership}
                  </span>
                  <button
                    onClick={() => handleRemove(m.userId)}
                    disabled={removing === m.userId}
                    className="shrink-0 text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                  >
                    {removing === m.userId ? "…" : "Remove"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          onClick={close}
          className="w-full text-sm border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50"
        >
          Close
        </button>
      </dialog>
    </>
  );
}

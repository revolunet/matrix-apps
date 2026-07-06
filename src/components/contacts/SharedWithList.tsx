import { useEffect, useState } from "react";
import { RoomMemberEvent } from "matrix-js-sdk";
import type { MatrixEvent, RoomMember } from "matrix-js-sdk";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { useAuthStore } from "@/stores/auth.store";

interface Props {
  dataRoomId: string;
  commentsRoomId: string;
}

export function SharedWithList({ dataRoomId, commentsRoomId }: Props) {
  const client = useMatrixClient();
  const userId = useAuthStore((s) => s.userId);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      const room = client.getRoom(dataRoomId);
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

    refresh();

    const onMembership = (_event: MatrixEvent, member: RoomMember) => {
      if (member.roomId === dataRoomId) refresh();
    };
    client.on(RoomMemberEvent.Membership, onMembership);
    return () => client.off(RoomMemberEvent.Membership, onMembership);
  }, [client, dataRoomId, userId]);

  const handleRemove = async (targetUserId: string) => {
    if (!confirm(`Remove ${targetUserId}'s access?`)) return;
    setRemoving(targetUserId);
    setError(null);
    try {
      // Kick from both rooms so the user loses access to data and comments
      await Promise.all([
        client.kick(dataRoomId, targetUserId),
        client.kick(commentsRoomId, targetUserId),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove user");
    } finally {
      setRemoving(null);
    }
  };

  if (members.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-700 mb-2">Shared with</h2>
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      <ul className="space-y-1.5">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 text-sm">
            <span className="font-mono text-gray-800 flex-1 truncate">
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
              title="Remove access"
            >
              {removing === m.userId ? "Removing…" : "Remove"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

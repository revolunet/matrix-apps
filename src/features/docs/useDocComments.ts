import { useEffect, useState } from "react";
import { MatrixEventEvent, RoomEvent } from "matrix-js-sdk";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";

export interface DocComment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

function extractComments(client: MatrixClient, roomId: string): DocComment[] {
  const room = client.getRoom(roomId);
  if (!room) return [];
  const events = room.getLiveTimeline().getEvents();
  const comments: DocComment[] = [];
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

/**
 * Reactive doc-comment list for a room. `extractComments` alone only reads a
 * snapshot of the live timeline — without subscribing to timeline/decryption
 * events, an incoming comment never triggers a re-render, so it silently sits
 * in the room until something unrelated causes the component to re-render.
 */
export function useDocComments(client: MatrixClient, roomId: string): DocComment[] {
  const [comments, setComments] = useState<DocComment[]>(() =>
    extractComments(client, roomId),
  );

  useEffect(() => {
    setComments(extractComments(client, roomId));

    const refresh = () => setComments(extractComments(client, roomId));

    const onTimeline = (_event: MatrixEvent, room?: Room) => {
      if (room?.roomId === roomId) refresh();
    };
    // Comment rooms are encrypted — a new message often arrives as
    // still-encrypted and only becomes readable once decryption finishes,
    // which fires separately from RoomEvent.Timeline.
    const onDecrypted = (event: MatrixEvent) => {
      if (event.getRoomId() === roomId) refresh();
    };

    client.on(RoomEvent.Timeline, onTimeline);
    client.on(MatrixEventEvent.Decrypted, onDecrypted);
    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
      client.off(MatrixEventEvent.Decrypted, onDecrypted);
    };
  }, [client, roomId]);

  return comments;
}

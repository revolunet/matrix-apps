import type { MatrixClient } from "matrix-js-sdk";
import { EventType } from "matrix-js-sdk";
import {
  EVENT_TYPE_COMMENT,
  EVENT_TYPE_CONTACT_UPDATE,
} from "@/lib/constants";
import { ContactSchema, type Contact } from "@/schemas/contact.schema";
import { CommentSchema, type Comment } from "@/schemas/comment.schema";

export async function sendContactUpdate(
  client: MatrixClient,
  dataRoomId: string,
  contact: Contact,
): Promise<void> {
  await client.sendEvent(dataRoomId, EVENT_TYPE_CONTACT_UPDATE as EventType, {
    contact,
    schema_version: 1,
  });
}

export async function sendComment(
  client: MatrixClient,
  commentsRoomId: string,
  contactId: string,
  body: string,
): Promise<void> {
  await client.sendEvent(commentsRoomId, EVENT_TYPE_COMMENT as EventType, {
    contact_id: contactId,
    body,
  });
}

export function extractLatestContact(
  client: MatrixClient,
  dataRoomId: string,
): Contact | null {
  const room = client.getRoom(dataRoomId);
  if (!room) return null;

  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.getType() !== EVENT_TYPE_CONTACT_UPDATE) continue;
    if (event.isBeingDecrypted() || event.isDecryptionFailure()) continue;
    const content = event.getContent();
    if (!content?.contact) continue;
    const parsed = ContactSchema.safeParse(content.contact);
    if (parsed.success) return parsed.data;
  }

  return null;
}

export function extractComments(
  client: MatrixClient,
  commentsRoomId: string,
): Comment[] {
  const room = client.getRoom(commentsRoomId);
  if (!room) return [];

  const events = room.getLiveTimeline().getEvents();
  const comments: Comment[] = [];

  for (const event of events) {
    if (event.getType() !== EVENT_TYPE_COMMENT) continue;
    if (event.isBeingDecrypted() || event.isDecryptionFailure()) continue;
    const content = event.getContent();
    const parsed = CommentSchema.safeParse({
      id: event.getId(),
      contactId: content.contact_id,
      authorId: event.getSender(),
      body: content.body,
      createdAt: new Date(event.getTs()).toISOString(),
    });
    if (parsed.success) comments.push(parsed.data);
  }

  return comments;
}

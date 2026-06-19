import type { MatrixClient } from "matrix-js-sdk";
import { EventType } from "matrix-js-sdk";
import {
  EVENT_TYPE_COMMENT,
  EVENT_TYPE_CONTACT_UPDATE,
  EVENT_TYPE_CONTACT_FILE,
} from "@/lib/constants";
import { ContactSchema, type Contact } from "@/schemas/contact.schema";
import { CommentSchema, type Comment } from "@/schemas/comment.schema";
import { ContactFileSchema, type ContactFile } from "@/schemas/file.schema";

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

export async function sendContactFile(
  client: MatrixClient,
  dataRoomId: string,
  contactId: string,
  file: File,
): Promise<void> {
  const { content_uri: mxcUri } = await client.uploadContent(file);
  await client.sendEvent(dataRoomId, EVENT_TYPE_CONTACT_FILE as EventType, {
    contact_id: contactId,
    filename: file.name,
    mxc_uri: mxcUri,
    mimetype: file.type || "application/octet-stream",
    size: file.size,
  });
}

export function extractFiles(
  client: MatrixClient,
  dataRoomId: string,
): ContactFile[] {
  const room = client.getRoom(dataRoomId);
  if (!room) return [];
  const files: ContactFile[] = [];
  for (const event of room.getLiveTimeline().getEvents()) {
    if (event.getType() !== EVENT_TYPE_CONTACT_FILE) continue;
    if (event.isBeingDecrypted() || event.isDecryptionFailure()) continue;
    const c = event.getContent();
    const parsed = ContactFileSchema.safeParse({
      id: event.getId(),
      contactId: c.contact_id,
      authorId: event.getSender(),
      filename: c.filename,
      mxcUri: c.mxc_uri,
      mimetype: c.mimetype,
      size: c.size,
      createdAt: new Date(event.getTs()).toISOString(),
    });
    if (parsed.success) files.push(parsed.data);
  }
  return files;
}

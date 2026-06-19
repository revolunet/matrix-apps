import type { MatrixClient } from "matrix-js-sdk";
import type { EntityConfig } from "@/entities/types";
import { CommentSchema, type Comment } from "@/schemas/comment.schema";
import { EntityFileSchema, type EntityFile } from "@/schemas/entity-file.schema";

// The Matrix JS SDK v41 uses overloaded sendEvent/setAccountData signatures that
// require event types to be members of its internal TimelineEvents / AccountDataEvents
// unions. Our custom app event types are not in those unions, so we bypass the
// generic overload resolution by casting through `unknown`.

export async function sendEntityUpdate(
  client: MatrixClient,
  config: EntityConfig,
  dataRoomId: string,
  data: unknown,
): Promise<void> {
  const eventType = `${config.eventTypePrefix}.update`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).sendEvent(dataRoomId, eventType, {
    entity: data,
    schema_version: 1,
  });
}

export function extractLatestEntity(
  client: MatrixClient,
  config: EntityConfig,
  dataRoomId: string,
): unknown | null {
  const room = client.getRoom(dataRoomId);
  if (!room) return null;

  const updateEventType = `${config.eventTypePrefix}.update`;
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.getType() !== updateEventType) continue;
    if (event.isBeingDecrypted() || event.isDecryptionFailure()) continue;
    const content = event.getContent();
    // Support both new format ({ entity: ... }) and old contact format ({ contact: ... })
    const payload = content?.entity ?? content?.contact;
    if (!payload) continue;
    const parsed = config.schema.safeParse(payload);
    if (parsed.success) return parsed.data;
  }

  return null;
}

export async function sendComment(
  client: MatrixClient,
  commentsRoomId: string,
  entityId: string,
  body: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).sendEvent(commentsRoomId, "m.room.message", {
    msgtype: "m.text",
    body,
    entity_id: entityId,
  });
}

export function extractComments(
  client: MatrixClient,
  commentsRoomId: string,
  fallbackEntityId?: string,
): Comment[] {
  const room = client.getRoom(commentsRoomId);
  if (!room) return [];

  const events = room.getLiveTimeline().getEvents();
  const comments: Comment[] = [];

  for (const event of events) {
    if (event.getType() !== "m.room.message") continue;
    if (event.isBeingDecrypted() || event.isDecryptionFailure()) continue;
    const content = event.getContent();
    if (content?.msgtype !== "m.text") continue;
    const parsed = CommentSchema.safeParse({
      id: event.getId(),
      contactId:
        content.entity_id ?? content.contact_id ?? fallbackEntityId,
      authorId: event.getSender(),
      body: content.body,
      createdAt: new Date(event.getTs()).toISOString(),
    });
    if (parsed.success) comments.push(parsed.data);
  }

  return comments;
}

export async function sendEntityFile(
  client: MatrixClient,
  config: EntityConfig,
  dataRoomId: string,
  entityId: string,
  file: File,
): Promise<void> {
  const { content_uri: mxcUri } = await client.uploadContent(file);
  const fileEventType = `${config.eventTypePrefix}.file`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).sendEvent(dataRoomId, fileEventType, {
    entity_id: entityId,
    filename: file.name,
    mxc_uri: mxcUri,
    mimetype: file.type || "application/octet-stream",
    size: file.size,
  });
}

export function extractFiles(
  client: MatrixClient,
  config: EntityConfig,
  dataRoomId: string,
): EntityFile[] {
  const room = client.getRoom(dataRoomId);
  if (!room) return [];
  const fileEventType = `${config.eventTypePrefix}.file`;
  const files: EntityFile[] = [];
  for (const event of room.getLiveTimeline().getEvents()) {
    if (event.getType() !== fileEventType) continue;
    if (event.isBeingDecrypted() || event.isDecryptionFailure()) continue;
    const c = event.getContent();
    const parsed = EntityFileSchema.safeParse({
      id: event.getId(),
      entityId: c.entity_id ?? c.contact_id,
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

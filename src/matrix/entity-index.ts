import { z } from "zod";
import type { MatrixClient } from "matrix-js-sdk";
import type { EntityConfig } from "@/entities/types";

export const EntityIndexEntrySchema = z.object({
  entityId: z.string().uuid(),
  dataRoomId: z.string(),
  commentsRoomId: z.string(),
  displayName: z.string(),
  addedAt: z.string().datetime(),
});

export type EntityIndexEntry = z.infer<typeof EntityIndexEntrySchema>;

const EntityIndexSchema = z.object({
  version: z.literal(1),
  entries: z.array(EntityIndexEntrySchema),
});

type EntityIndex = z.infer<typeof EntityIndexSchema>;

const EMPTY_INDEX: EntityIndex = { version: 1, entries: [] };

function indexEventType(config: EntityConfig): string {
  return `${config.eventTypePrefix}_index`;
}

export function loadEntityIndex(
  client: MatrixClient,
  config: EntityConfig,
): EntityIndexEntry[] {
  // Custom account data keys are not in the SDK's AccountDataEvents union; cast through any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = (client as any).getAccountData(indexEventType(config));
  if (!event) return [];
  const parsed = EntityIndexSchema.safeParse(event.getContent());
  if (!parsed.success) return [];
  return parsed.data.entries;
}

export async function saveEntityIndex(
  client: MatrixClient,
  config: EntityConfig,
  entries: EntityIndexEntry[],
): Promise<void> {
  const index: EntityIndex = { ...EMPTY_INDEX, entries };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).setAccountData(indexEventType(config), index);
}

export async function addEntityToIndex(
  client: MatrixClient,
  config: EntityConfig,
  entry: EntityIndexEntry,
): Promise<void> {
  const entries = loadEntityIndex(client, config);
  const idx = entries.findIndex((e) => e.entityId === entry.entityId);
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }
  await saveEntityIndex(client, config, entries);
}

export async function removeEntityFromIndex(
  client: MatrixClient,
  config: EntityConfig,
  entityId: string,
): Promise<void> {
  const entries = loadEntityIndex(client, config);
  await saveEntityIndex(
    client,
    config,
    entries.filter((e) => e.entityId !== entityId),
  );
}

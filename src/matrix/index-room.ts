import type { MatrixClient } from "matrix-js-sdk";
import {
  ContactIndexSchema,
  EMPTY_INDEX,
  INDEX_EVENT_TYPE,
  type ContactIndex,
  type IndexEntry,
} from "@/schemas/index.schema";

export function loadContactIndex(client: MatrixClient): ContactIndex {
  const event = client.getAccountData(INDEX_EVENT_TYPE);
  if (!event) return { ...EMPTY_INDEX };

  const parsed = ContactIndexSchema.safeParse(event.getContent());
  if (!parsed.success) return { ...EMPTY_INDEX };
  return parsed.data;
}

export async function saveContactIndex(
  client: MatrixClient,
  index: ContactIndex,
): Promise<void> {
  ContactIndexSchema.parse(index); // validate before saving
  await client.setAccountData(INDEX_EVENT_TYPE, index);
}

export async function addContactToIndex(
  client: MatrixClient,
  entry: IndexEntry,
): Promise<void> {
  const index = loadContactIndex(client);
  const existing = index.contacts.findIndex(
    (c) => c.contactId === entry.contactId,
  );
  if (existing >= 0) {
    index.contacts[existing] = entry;
  } else {
    index.contacts.push(entry);
  }
  await saveContactIndex(client, index);
}

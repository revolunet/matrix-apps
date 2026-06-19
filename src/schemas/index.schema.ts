import { z } from "zod";

export const INDEX_EVENT_TYPE = "org.demo-e2e-app.contact_index";

export const IndexEntrySchema = z.object({
  contactId: z.string().uuid(),
  dataRoomId: z.string(),
  commentsRoomId: z.string(),
  displayName: z.string(),
  addedAt: z.string().datetime(),
});

export type IndexEntry = z.infer<typeof IndexEntrySchema>;

export const ContactIndexSchema = z.object({
  version: z.literal(1),
  contacts: z.array(IndexEntrySchema),
});

export type ContactIndex = z.infer<typeof ContactIndexSchema>;

export const EMPTY_INDEX: ContactIndex = { version: 1, contacts: [] };

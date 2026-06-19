import { z } from "zod";

export const ContactFileSchema = z.object({
  id: z.string(),           // Matrix event ID
  contactId: z.string().uuid(),
  authorId: z.string(),     // Matrix userId
  filename: z.string(),
  mxcUri: z.string(),       // mxc:// URI from uploadContent
  mimetype: z.string(),
  size: z.number(),
  createdAt: z.string().datetime(),
});

export type ContactFile = z.infer<typeof ContactFileSchema>;

import { z } from "zod";

export const CommentSchema = z.object({
  id: z.string(), // Matrix event ID ($...)
  contactId: z.string().uuid(),
  authorId: z.string(), // Matrix userId (@user:server)
  body: z.string().min(1),
  createdAt: z.string().datetime(),
});

export type Comment = z.infer<typeof CommentSchema>;

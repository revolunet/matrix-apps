import { z } from "zod";

export const GenderEnum = z.enum([
  "male",
  "female",
  "other",
  "prefer_not_to_say",
]);

export type Gender = z.infer<typeof GenderEnum>;

export const ContactSchema = z.object({
  id: z.string().uuid(),
  fullname: z.string().min(1, "Full name is required"),
  email: z.string().email("Invalid email address"),
  gender: GenderEnum,
  birthdate: z.string().optional(),        // ISO date string (YYYY-MM-DD), optional
  preferred_color: z.string().optional(),  // CSS hex color, optional
  createdAt: z.string().datetime(),
  createdBy: z.string().optional(), // Matrix userId of the creator
  updatedAt: z.string().datetime(),
  dataRoomId: z.string().optional(),
  commentsRoomId: z.string().optional(),
});

export type Contact = z.infer<typeof ContactSchema>;

export const ContactFormSchema = ContactSchema.omit({
  id: true,
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  dataRoomId: true,
  commentsRoomId: true,
});

export type ContactFormData = z.infer<typeof ContactFormSchema>;

import { z } from "zod";

export const CompanySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Company name is required"),
  email: z.string().email("Invalid email address").optional(),
  website: z.string().optional(),
  contactIds: z.array(z.string().uuid()).default([]),
  createdAt: z.string().datetime(),
  createdBy: z.string().optional(),
  updatedAt: z.string().datetime(),
  dataRoomId: z.string().optional(),
  commentsRoomId: z.string().optional(),
});

export type Company = z.infer<typeof CompanySchema>;

export const CompanyFormSchema = CompanySchema.omit({
  id: true,
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  dataRoomId: true,
  commentsRoomId: true,
});

export type CompanyFormData = z.infer<typeof CompanyFormSchema>;

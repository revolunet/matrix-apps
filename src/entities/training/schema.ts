import { z } from "zod";

export const TrainingSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  participantIds: z.array(z.string().uuid()).default([]),
  createdAt: z.string().datetime(),
  createdBy: z.string().optional(),
  updatedAt: z.string().datetime(),
  dataRoomId: z.string().optional(),
  commentsRoomId: z.string().optional(),
});

export type Training = z.infer<typeof TrainingSchema>;

export const TrainingFormSchema = TrainingSchema.omit({
  id: true,
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  dataRoomId: true,
  commentsRoomId: true,
});

export type TrainingFormData = z.infer<typeof TrainingFormSchema>;

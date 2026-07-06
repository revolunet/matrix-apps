import { registerEntity } from "@/entities/registry";
import { TrainingSchema, TrainingFormSchema } from "./schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATA_PREFIX = "demo-e2e-app/channels/training-";
const COMMENTS_SUFFIX = "-comments";

registerEntity({
  type: "training",
  label: "Training",
  pluralLabel: "Trainings",
  icon: "📚",
  urlSegment: "trainings",
  schema: TrainingSchema,
  formSchema: TrainingFormSchema,
  fields: [
    { name: "title", label: "Title", type: "text", required: true },
    { name: "description", label: "Description", type: "text" },
    { name: "startDate", label: "Start Date", type: "date" },
    { name: "endDate", label: "End Date", type: "date" },
    {
      name: "participantIds",
      label: "Participants",
      type: "relation",
      relation: { entityType: "contact", multiple: true },
    },
  ],
  eventTypePrefix: "org.demo-e2e-app.training",
  roomNameFn: (id, suffix) =>
    `${DATA_PREFIX}${id}${suffix ? `-${suffix}` : ""}`,
  displayNameFn: (data: unknown) => {
    const d = data as Record<string, unknown>;
    return (d?.title as string) ?? (d?.id as string) ?? "";
  },
  matchRoomName: (roomName) => {
    if (!roomName.startsWith(DATA_PREFIX)) return null;
    const rest = roomName.slice(DATA_PREFIX.length);

    if (rest.endsWith(COMMENTS_SUFFIX)) {
      const entityId = rest.slice(0, -COMMENTS_SUFFIX.length);
      if (!UUID_RE.test(entityId)) return null;
      return { entityId, isComments: true };
    }

    if (!UUID_RE.test(rest)) return null;
    return { entityId: rest, isComments: false };
  },
});

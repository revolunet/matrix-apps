import { registerEntity } from "@/entities/registry";
import { ContactSchema, ContactFormSchema } from "./schema";

// UUID v4 regex for matching room names
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATA_PREFIX = "demo-e2e-app/channels/";
const COMMENTS_SUFFIX = "-comments";

registerEntity({
  type: "contact",
  label: "Contact",
  pluralLabel: "Contacts",
  icon: "👤",
  urlSegment: "contacts",
  schema: ContactSchema,
  formSchema: ContactFormSchema,
  fields: [
    { name: "fullname", label: "Full Name", type: "text", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    {
      name: "gender",
      label: "Gender",
      type: "select",
      required: true,
      options: [
        { value: "male", label: "Male" },
        { value: "female", label: "Female" },
        { value: "other", label: "Other" },
        { value: "prefer_not_to_say", label: "Prefer not to say" },
      ],
    },
    { name: "birthdate", label: "Birthdate", type: "date" },
    { name: "preferred_color", label: "Preferred Color", type: "color" },
    { name: "avatarMxcUri", label: "Avatar", type: "avatar" },
  ],
  eventTypePrefix: "org.demo-e2e-app.contact",
  roomNameFn: (id, suffix) =>
    `${DATA_PREFIX}${id}${suffix ? `-${suffix}` : ""}`,
  displayNameFn: (data: unknown) => {
    const d = data as Record<string, unknown>;
    return (d?.fullname as string) ?? (d?.id as string) ?? "";
  },
  matchRoomName: (roomName) => {
    if (!roomName.startsWith(DATA_PREFIX)) return null;
    const rest = roomName.slice(DATA_PREFIX.length);

    // Company rooms start with 'company-', skip them
    if (rest.startsWith("company-")) return null;

    if (rest.endsWith(COMMENTS_SUFFIX)) {
      const entityId = rest.slice(0, -COMMENTS_SUFFIX.length);
      if (!UUID_RE.test(entityId)) return null;
      return { entityId, isComments: true };
    }

    if (!UUID_RE.test(rest)) return null;
    return { entityId: rest, isComments: false };
  },
});

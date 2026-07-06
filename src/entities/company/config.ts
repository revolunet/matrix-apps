import { registerEntity } from "@/entities/registry";
import { CompanySchema, CompanyFormSchema } from "./schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATA_PREFIX = "demo-e2e-app/channels/company-";
const COMMENTS_SUFFIX = "-comments";

registerEntity({
  type: "company",
  label: "Company",
  pluralLabel: "Companies",
  icon: "🏢",
  urlSegment: "companies",
  schema: CompanySchema,
  formSchema: CompanyFormSchema,
  fields: [
    { name: "name", label: "Company Name", type: "text", required: true },
    { name: "email", label: "Email", type: "email" },
    { name: "website", label: "Website", type: "text" },
    {
      name: "contactIds",
      label: "Contacts",
      type: "relation",
      relation: { entityType: "contact", multiple: true },
    },
  ],
  eventTypePrefix: "org.demo-e2e-app.company",
  roomNameFn: (id, suffix) =>
    `${DATA_PREFIX}${id}${suffix ? `-${suffix}` : ""}`,
  displayNameFn: (data: unknown) => {
    const d = data as Record<string, unknown>;
    return (d?.name as string) ?? (d?.id as string) ?? "";
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

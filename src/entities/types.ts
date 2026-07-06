import type { ZodTypeAny } from "zod";

export type FieldType = "text" | "email" | "date" | "select" | "color" | "avatar" | "relation";

export interface FieldDefinition {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[]; // for 'select'
  relation?: {
    entityType: string; // key in registry
    multiple: boolean;
  };
}

export interface EntityConfig<TSchema extends ZodTypeAny = ZodTypeAny> {
  type: string; // unique key: 'contact', 'company'
  label: string;
  pluralLabel: string;
  icon: string; // emoji shown in sidebar
  urlSegment: string; // URL path segment: 'contacts', 'companies'
  schema: TSchema; // full schema (with system fields: id, timestamps, roomIds)
  formSchema: TSchema; // form schema (system fields omitted)
  fields: FieldDefinition[];
  eventTypePrefix: string; // e.g. 'org.demo-e2e-app.contact'
  roomNameFn: (id: string, suffix?: string) => string;
  displayNameFn: (data: unknown) => string; // used in list + index
  // Returns entityId if this room name belongs to this entity's data or comments room, null otherwise
  matchRoomName: (roomName: string) => { entityId: string; isComments: boolean } | null;
}

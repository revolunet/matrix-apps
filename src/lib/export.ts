import type { Contact } from "@/schemas/contact.schema";
import type { Comment } from "@/schemas/comment.schema";
import type { ContactFile } from "@/schemas/file.schema";

export function exportContactsJson(
  contacts: Record<string, Contact>,
  comments: Record<string, Comment[]>,
  files: Record<string, ContactFile[]>,
): void {
  const rows = Object.values(contacts)
    .sort((a, b) => a.fullname.localeCompare(b.fullname))
    .map((contact) => ({
      id: contact.id,
      fullname: contact.fullname,
      email: contact.email,
      gender: contact.gender,
      birthdate: contact.birthdate ?? null,
      preferred_color: contact.preferred_color ?? null,
      avatarMxcUri: contact.avatarMxcUri ?? null,
      createdAt: contact.createdAt,
      createdBy: contact.createdBy ?? null,
      updatedAt: contact.updatedAt,
      comments: (comments[contact.id] ?? []).map((c) => ({
        authorId: c.authorId,
        body: c.body,
        createdAt: c.createdAt,
      })),
      files: (files[contact.id] ?? []).map((f) => ({
        filename: f.filename,
        mimetype: f.mimetype,
        size: f.size,
        mxcUri: f.mxcUri,
        authorId: f.authorId,
        createdAt: f.createdAt,
      })),
    }));

  const payload = {
    exportedAt: new Date().toISOString(),
    contacts: rows,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `contacts-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

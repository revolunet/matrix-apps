import { useParams, useNavigate } from "react-router-dom";
import { useContactsStore } from "@/stores/contacts.store";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { ContactForm } from "@/components/contacts/ContactForm";
import { CommentsFeed } from "@/components/comments/CommentsFeed";
import { FileDropZone } from "@/components/contacts/FileDropZone";
import { ShareDialog } from "@/components/contacts/ShareDialog";
import { SharedWithList } from "@/components/contacts/SharedWithList";
import { sendContactUpdate } from "@/matrix/events";
import { sendComment } from "@/matrix/events";
import type { ContactFormData } from "@/schemas/contact.schema";

export function ContactDetailPage() {
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();
  const client = useMatrixClient();
  const contacts = useContactsStore((s) => s.contacts);
  const comments = useContactsStore((s) => s.comments);
  const indexEntries = useContactsStore((s) => s.indexEntries);
  const upsertContact = useContactsStore((s) => s.upsertContact);

  if (!contactId) return null;

  const contact = contacts[contactId];
  const contactComments = comments[contactId] ?? [];
  const indexEntry = indexEntries.find((e) => e.contactId === contactId);

  if (!contact && !indexEntry) {
    return (
      <div className="text-sm text-gray-500 py-8">
        Contact not found.{" "}
        <button
          onClick={() => navigate("/contacts")}
          className="underline text-blue-600"
        >
          Back to contacts
        </button>
      </div>
    );
  }

  const handleUpdate = async (data: ContactFormData) => {
    if (!contact) return;
    const updated = {
      ...contact,
      ...data,
      updatedAt: new Date().toISOString(),
    };
    if (!contact.dataRoomId) throw new Error("Data room not found");
    await sendContactUpdate(client, contact.dataRoomId, updated);
    upsertContact(updated);
  };

  const handlePostComment = async (body: string) => {
    const commentsRoomId =
      contact?.commentsRoomId ?? indexEntry?.commentsRoomId;
    if (!commentsRoomId) throw new Error("Comments room not found");
    await sendComment(client, commentsRoomId, contactId, body);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate("/contacts")}
            className="text-sm text-gray-500 hover:text-black mb-2 block"
          >
            ← Back
          </button>
          <h1 className="text-lg font-semibold text-gray-900">
            {contact?.fullname ?? indexEntry?.displayName ?? "Contact"}
          </h1>
          <dl className="mt-1 space-y-0.5">
            {contact?.createdAt && (
              <div className="flex gap-2 text-xs text-gray-400">
                <dt>Created</dt>
                <dd>{new Date(contact.createdAt).toLocaleString()}</dd>
              </div>
            )}
            {contact?.createdBy && (
              <div className="flex gap-2 text-xs text-gray-400">
                <dt>By</dt>
                <dd className="font-mono">{contact.createdBy}</dd>
              </div>
            )}
          </dl>
        </div>
        <ShareDialog contactId={contactId} />
      </div>

      {contact ? (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Edit Contact
          </h2>
          <ContactForm
            defaultValues={{
              fullname: contact.fullname,
              email: contact.email,
              gender: contact.gender,
              birthdate: contact.birthdate,
              preferred_color: contact.preferred_color,
              avatarMxcUri: contact.avatarMxcUri,
            }}
            onSubmit={handleUpdate}
            submitLabel="Update Contact"
          />
        </section>
      ) : (
        <p className="text-sm text-gray-500">
          Contact data is still syncing...
        </p>
      )}

      {(contact?.dataRoomId ?? indexEntry?.dataRoomId) && (
        <SharedWithList
          dataRoomId={(contact?.dataRoomId ?? indexEntry?.dataRoomId)!}
          commentsRoomId={(contact?.commentsRoomId ?? indexEntry?.commentsRoomId)!}
        />
      )}

      {(contact?.dataRoomId ?? indexEntry?.dataRoomId) && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Documents</h2>
          <FileDropZone
            contactId={contactId}
            dataRoomId={(contact?.dataRoomId ?? indexEntry?.dataRoomId)!}
          />
        </section>
      )}

      <section>
        <CommentsFeed
          comments={contactComments}
          onPostComment={handlePostComment}
        />
      </section>
    </div>
  );
}

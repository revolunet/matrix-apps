import { useNavigate } from "react-router-dom";
import { ContactForm } from "@/components/contacts/ContactForm";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { useAuthStore } from "@/stores/auth.store";
import { useContactsStore } from "@/stores/contacts.store";
import { createContactRooms } from "@/matrix/rooms";
import { sendContactUpdate } from "@/matrix/events";
import { addContactToIndex } from "@/matrix/index-room";
import type { ContactFormData } from "@/schemas/contact.schema";
import type { Contact } from "@/schemas/contact.schema";

export function NewContactPage() {
  const navigate = useNavigate();
  const client = useMatrixClient();
  const userId = useAuthStore((s) => s.userId);
  const { upsertContact, addIndexEntry } = useContactsStore();

  const handleSubmit = async (data: ContactFormData) => {
    const contactId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { dataRoomId, commentsRoomId } = await createContactRooms(
      client,
      contactId,
    );

    const contact: Contact = {
      id: contactId,
      ...data,
      createdAt: now,
      createdBy: userId ?? undefined,
      updatedAt: now,
      dataRoomId,
      commentsRoomId,
    };

    await sendContactUpdate(client, dataRoomId, contact);

    await addContactToIndex(client, {
      contactId,
      dataRoomId,
      commentsRoomId,
      displayName: data.fullname,
      addedAt: now,
    });

    addIndexEntry({
      contactId,
      dataRoomId,
      commentsRoomId,
      displayName: data.fullname,
      addedAt: now,
    });
    upsertContact(contact);

    navigate(`/contacts/${contactId}`);
  };

  return (
    <div>
      <h1 className="text-lg font-semibold text-gray-900 mb-6">New Contact</h1>
      <ContactForm onSubmit={handleSubmit} submitLabel="Create Contact" />
    </div>
  );
}

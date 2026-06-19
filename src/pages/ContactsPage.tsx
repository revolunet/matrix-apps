import { Link } from "react-router-dom";
import { useContactsStore } from "@/stores/contacts.store";
import { useSyncStore } from "@/stores/sync.store";
import { ContactsTable } from "@/components/contacts/ContactsTable";

export function ContactsPage() {
  // Select the map reference (stable with Immer), convert to array outside the
  // selector. Object.values() inside a selector returns a new array on every
  // call → Zustand's Object.is check always fails → infinite re-render loop.
  const contactsMap = useContactsStore((s) => s.contacts);
  const contacts = Object.values(contactsMap);
  const isReady = useSyncStore((s) => s.isReady);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-gray-900">Contacts</h1>
        <Link
          to="/contacts/new"
          className="bg-black text-white text-sm px-4 py-2 rounded hover:bg-gray-800"
        >
          New Contact
        </Link>
      </div>

      {!isReady ? (
        <p className="text-sm text-gray-500">Syncing with Matrix...</p>
      ) : (
        <ContactsTable contacts={contacts} />
      )}
    </div>
  );
}

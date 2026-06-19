import { Link, useParams } from "react-router-dom";
import { useContactsStore } from "@/stores/contacts.store";
import { useSyncStore } from "@/stores/sync.store";

export function ContactsList() {
  const { contactId: activeId } = useParams();
  const contactsMap = useContactsStore((s) => s.contacts);
  const indexEntries = useContactsStore((s) => s.indexEntries);
  const isReady = useSyncStore((s) => s.isReady);

  if (!isReady) {
    return <p className="text-xs text-gray-400 px-3 py-4">Syncing...</p>;
  }

  const items = indexEntries
    .map((entry) => {
      const contact = contactsMap[entry.contactId];
      return {
        id: entry.contactId,
        name: contact?.fullname ?? entry.displayName,
        email: contact?.email,
        color: contact?.preferred_color,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (items.length === 0) {
    return (
      <p className="text-xs text-gray-400 px-3 py-4 text-center">
        No contacts yet.
      </p>
    );
  }

  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <Link
            to={`/contacts/${item.id}`}
            className={`flex items-center gap-2 px-3 py-2.5 text-sm border-b border-gray-100 hover:bg-gray-100 ${
              activeId === item.id ? "bg-gray-100 font-medium text-black" : "text-gray-700"
            }`}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.color ?? "#d1d5db" }}
            />
            <span className="truncate">{item.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

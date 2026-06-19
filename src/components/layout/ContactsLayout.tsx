import { Link, Outlet, useMatch } from "react-router-dom";
import { ContactsList } from "@/components/contacts/ContactsList";

export function ContactsLayout() {
  const isNew = useMatch("/contacts/new");

  return (
    <div className="flex h-full">
      {/* Left panel: scrollable contact list */}
      <div className="w-60 flex-none border-r border-gray-200 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 flex-none">
          <span className="text-sm font-semibold text-gray-800">Contacts</span>
          <Link
            to="/contacts/new"
            className={`text-xs px-2 py-1 rounded ${
              isNew
                ? "bg-gray-200 text-gray-900"
                : "bg-black text-white hover:bg-gray-800"
            }`}
          >
            + New
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ContactsList />
        </div>
      </div>

      {/* Right panel: detail or form */}
      <div className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  );
}

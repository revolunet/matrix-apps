import { NavLink } from "react-router-dom";

export function Sidebar() {
  return (
    <aside className="w-48 flex-none border-r border-gray-200 bg-gray-50 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200">
        <span className="text-sm font-semibold text-gray-800">Matrix CMS</span>
      </div>
      <nav className="flex flex-col gap-1 p-2">
        <NavLink
          to="/contacts"
          className={({ isActive }) =>
            `text-sm font-medium px-3 py-2 rounded hover:underline ${isActive ? "text-black font-semibold" : "text-gray-600"}`
          }
        >
          Contacts
        </NavLink>
        <NavLink
          to="/contacts/new"
          className={({ isActive }) =>
            `text-sm font-medium px-3 py-2 rounded hover:underline ${isActive ? "text-black font-semibold" : "text-gray-600"}`
          }
        >
          New Contact
        </NavLink>
      </nav>
    </aside>
  );
}

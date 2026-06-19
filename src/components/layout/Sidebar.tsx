import { NavLink } from "react-router-dom";
import { getAllEntityConfigs } from "@/entities/registry";

export function Sidebar() {
  const configs = getAllEntityConfigs();

  return (
    <aside className="w-48 flex-none border-r border-gray-200 bg-gray-50 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-200">
        <span className="text-sm font-semibold text-gray-800">Matrix CMS</span>
      </div>
      <nav className="flex flex-col gap-1 p-2">
        {configs.map((config) => (
          <NavLink
            key={config.type}
            to={`/${config.urlSegment}`}
            className="text-sm font-medium px-3 py-2 rounded hover:underline text-black font-semibold"
          >
            {config.pluralLabel}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

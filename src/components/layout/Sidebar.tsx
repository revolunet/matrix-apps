import { useState } from "react";
import { NavLink } from "react-router-dom";
import { getAllEntityConfigs } from "@/entities/registry";

const STORAGE_KEY = "cms_sidebar_collapsed";

function linkClass(isActive: boolean, collapsed: boolean) {
  const base =
    "flex items-center gap-2.5 text-sm font-medium rounded transition-colors";
  const state = isActive
    ? "bg-blue-50 text-blue-700"
    : "text-gray-700 hover:bg-gray-100";
  const layout = collapsed ? "justify-center px-0 py-2" : "px-3 py-2";
  return `${base} ${state} ${layout}`;
}

export function Sidebar() {
  const configs = getAllEntityConfigs();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true",
  );

  const toggle = () =>
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });

  return (
    <aside
      className={`flex-none border-r border-gray-200 bg-gray-50 flex flex-col overflow-hidden transition-[width] duration-200 ${
        collapsed ? "w-14" : "w-48"
      }`}
    >
      {/* Header */}
      <div className="flex items-center border-b border-gray-200 px-2 py-3 gap-2 flex-none">
        {!collapsed && (
          <span className="flex-1 text-sm font-semibold text-gray-800 truncate pl-1">
            Matrix CMS
          </span>
        )}
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`flex-none flex items-center justify-center w-7 h-7 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-colors ${
            collapsed ? "mx-auto" : "ml-auto"
          }`}
        >
          {/* Double chevron pointing in the collapse direction */}
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`w-4 h-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
          >
            <polyline points="10 4 6 8 10 12" />
            <polyline points="6 4 2 8 6 12" />
          </svg>
        </button>
      </div>

      {/* Nav */}
      <nav className={`flex flex-col gap-0.5 p-2 flex-1`}>
        <NavLink
          to="/docs"
          title={collapsed ? "Docs" : undefined}
          className={({ isActive }) => linkClass(isActive, collapsed)}
        >
          <span className="text-base leading-none flex-none">📄</span>
          {!collapsed && <span className="truncate">Docs</span>}
        </NavLink>

        <div className="my-1 border-t border-gray-200" />

        {configs.map((config) => (
          <NavLink
            key={config.type}
            to={`/${config.urlSegment}`}
            title={collapsed ? config.pluralLabel : undefined}
            className={({ isActive }) => linkClass(isActive, collapsed)}
          >
            <span className="text-base leading-none flex-none">{config.icon}</span>
            {!collapsed && <span className="truncate">{config.pluralLabel}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

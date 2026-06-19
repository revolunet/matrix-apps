import { Link, Outlet, useMatch, useParams } from "react-router-dom";
import { getEntityConfigBySegment } from "@/entities/registry";
import { EntityList } from "@/components/entity/EntityList";

export function EntityLayout() {
  const { entityType } = useParams<{ entityType: string }>();
  // Always call hooks at top level — conditional returns must come after
  const isNew = useMatch(`/${entityType ?? ""}/new`);

  if (!entityType) return null;

  let config;
  try {
    config = getEntityConfigBySegment(entityType);
  } catch {
    return (
      <div className="p-6 text-sm text-red-500">
        Unknown entity type: {entityType}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left panel: scrollable entity list */}
      <div className="w-60 flex-none border-r border-gray-200 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 flex-none">
          <span className="text-sm font-semibold text-gray-800">
            {config.pluralLabel}
          </span>
          <Link
            to={`/${entityType}/new`}
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
          <EntityList config={config} />
        </div>
      </div>

      {/* Right panel: detail or form */}
      <div className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  );
}

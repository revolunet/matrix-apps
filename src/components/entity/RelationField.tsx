import { useState } from "react";
import { Link } from "react-router-dom";
import type { FieldDefinition } from "@/entities/types";
import { getEntityConfig } from "@/entities/registry";
import { useEntityStore } from "@/stores/entity.store";

interface Props {
  field: FieldDefinition;
  value: string[];
  onChange: (ids: string[]) => void;
}

export function RelationField({ field, value, onChange }: Props) {
  const [search, setSearch] = useState("");

  // Hooks must be called unconditionally, before any early returns.
  // Select the raw entity map; the ?? {} fallback stays outside the selector
  // to avoid returning a new object reference on every render.
  const entityMapRaw = useEntityStore(
    (s) => s.entities[field.relation?.entityType ?? ""],
  );

  if (!field.relation) return null;

  const targetConfig = getEntityConfig(field.relation.entityType);
  const entityMap = entityMapRaw ?? {};
  const allEntities = Object.values(entityMap);

  const filtered = allEntities.filter((e) => {
    const name = targetConfig.displayNameFn(e).toLowerCase();
    return name.includes(search.toLowerCase());
  });

  const getEntityId = (e: unknown): string =>
    (e as Record<string, unknown>).id as string;

  const toggleId = (id: string) => {
    if (field.relation!.multiple) {
      onChange(
        value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
      );
    } else {
      onChange(value.includes(id) ? [] : [id]);
    }
  };

  const selectedItems = allEntities.filter((e) =>
    value.includes(getEntityId(e)),
  );

  return (
    <div className="space-y-2">
      {selectedItems.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedItems.map((e) => (
            <span
              key={getEntityId(e)}
              className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded"
            >
              <Link
                to={`/${targetConfig.urlSegment}/${getEntityId(e)}`}
                className="hover:underline"
              >
                {targetConfig.displayNameFn(e)}
              </Link>
              <button
                type="button"
                onClick={() => toggleId(getEntityId(e))}
                className="hover:text-blue-600"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={`Search ${targetConfig.pluralLabel.toLowerCase()}...`}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
      />

      {search && (
        <ul className="border border-gray-200 rounded max-h-40 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">No results</li>
          ) : (
            filtered.map((e) => {
              const id = getEntityId(e);
              const selected = value.includes(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => toggleId(id)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                      selected ? "font-medium text-blue-700" : "text-gray-700"
                    }`}
                  >
                    {selected && <span className="text-blue-500">✓</span>}
                    {targetConfig.displayNameFn(e)}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

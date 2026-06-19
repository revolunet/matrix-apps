import { Link, useParams } from "react-router-dom";
import type { EntityConfig } from "@/entities/types";
import { useEntityStore } from "@/stores/entity.store";
import { useSyncStore } from "@/stores/sync.store";

interface Props {
  config: EntityConfig;
}

export function EntityList({ config }: Props) {
  const { entityId: activeId } = useParams<{ entityId: string }>();
  // Select the raw nested maps — Immer keeps these as stable references when
  // unchanged. Do NOT use ?? {} or ?? [] inside the selector: that produces
  // a new object on every call and triggers an infinite snapshot loop.
  const entityMap = useEntityStore((s) => s.entities[config.type]);
  const indexEntries = useEntityStore((s) => s.indices[config.type]);
  const isReady = useSyncStore((s) => s.isReady);

  if (!isReady) {
    return <p className="text-xs text-gray-400 px-3 py-4">Syncing...</p>;
  }

  const entries = indexEntries ?? [];
  const map = entityMap ?? {};

  const items = entries
    .map((entry) => {
      const data = map[entry.entityId] as Record<string, unknown> | undefined;
      const displayName = data
        ? config.displayNameFn(data)
        : entry.displayName;
      const color = data?.preferred_color as string | undefined;
      return { id: entry.entityId, name: displayName, color };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (items.length === 0) {
    return (
      <p className="text-xs text-gray-400 px-3 py-4 text-center">
        No {config.pluralLabel.toLowerCase()} yet.
      </p>
    );
  }

  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <Link
            to={`/${config.urlSegment}/${item.id}`}
            className={`flex items-center gap-2 px-3 py-2.5 text-sm border-b border-gray-100 hover:bg-gray-100 ${
              activeId === item.id
                ? "bg-gray-100 font-medium text-black"
                : "text-gray-700"
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

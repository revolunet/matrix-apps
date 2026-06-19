import { useParams } from "react-router-dom";
import { getEntityConfigBySegment } from "@/entities/registry";

export function EntityListPage() {
  const { entityType } = useParams<{ entityType: string }>();
  if (!entityType) return null;

  let config;
  try {
    config = getEntityConfigBySegment(entityType);
  } catch {
    return null;
  }

  return (
    <div className="h-full flex items-center justify-center text-sm text-gray-400">
      Select a {config.label.toLowerCase()} to view details.
    </div>
  );
}

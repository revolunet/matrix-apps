import { useNavigate, useParams } from "react-router-dom";
import { getEntityConfigBySegment } from "@/entities/registry";
import { EntityForm } from "@/components/entity/EntityForm";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { useAuthStore } from "@/stores/auth.store";
import { useEntityStore } from "@/stores/entity.store";
import { createEntityRooms } from "@/matrix/entity-rooms";
import { sendEntityUpdate } from "@/matrix/entity-events";
import { addEntityToIndex } from "@/matrix/entity-index";

export function NewEntityPage() {
  const { entityType } = useParams<{ entityType: string }>();
  const navigate = useNavigate();
  const client = useMatrixClient();
  const userId = useAuthStore((s) => s.userId);
  const { upsertEntity, addIndexEntry } = useEntityStore();

  if (!entityType) return null;

  let config;
  try {
    config = getEntityConfigBySegment(entityType);
  } catch {
    return (
      <div className="text-sm text-red-500">Unknown entity type: {entityType}</div>
    );
  }

  const handleSubmit = async (data: Record<string, unknown>) => {
    const entityId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { dataRoomId, commentsRoomId } = await createEntityRooms(
      client,
      config,
      entityId,
    );

    const entity = {
      id: entityId,
      ...data,
      createdAt: now,
      createdBy: userId ?? undefined,
      updatedAt: now,
      dataRoomId,
      commentsRoomId,
    };

    await sendEntityUpdate(client, config, dataRoomId, entity);

    const displayName = config.displayNameFn(entity);

    await addEntityToIndex(client, config, {
      entityId,
      dataRoomId,
      commentsRoomId,
      displayName,
      addedAt: now,
    });

    addIndexEntry(config.type, {
      entityId,
      dataRoomId,
      commentsRoomId,
      displayName,
      addedAt: now,
    });
    upsertEntity(config.type, entityId, entity);

    navigate(`/${entityType}/${entityId}`);
  };

  return (
    <div>
      <h1 className="text-lg font-semibold text-gray-900 mb-6">
        New {config.label}
      </h1>
      <EntityForm
        config={config}
        onSubmit={handleSubmit}
        submitLabel={`Create ${config.label}`}
      />
    </div>
  );
}

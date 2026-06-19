import { useParams } from "react-router-dom";
import { getEntityConfigBySegment } from "@/entities/registry";
import type { EntityConfig } from "@/entities/types";
import { useEntityStore } from "@/stores/entity.store";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { EntityForm } from "@/components/entity/EntityForm";
import { CommentsFeed } from "@/components/comments/CommentsFeed";
import { FileDropZone } from "@/components/contacts/FileDropZone";
import { ShareDialog } from "@/components/contacts/ShareDialog";
import { SharedWithList } from "@/components/contacts/SharedWithList";
import { sendEntityUpdate, sendComment } from "@/matrix/entity-events";

export function EntityDetailPage() {
  const { entityType, entityId } = useParams<{
    entityType: string;
    entityId: string;
  }>();
  const client = useMatrixClient();
  const upsertEntity = useEntityStore((s) => s.upsertEntity);

  // Resolve config safely — all hooks must be called before any early return.
  let config: EntityConfig | null = null;
  try {
    if (entityType) config = getEntityConfigBySegment(entityType);
  } catch {
    // handled after hooks
  }

  const type = config?.type ?? "";
  const id = entityId ?? "";

  // Stable selectors: Immer returns the same reference when data is unchanged.
  // Keep ?? fallbacks outside the selector to avoid new-object-per-render.
  const entity = useEntityStore(
    (s) => s.entities[type]?.[id] as Record<string, unknown> | undefined,
  );
  const rawComments = useEntityStore((s) => s.comments[type]?.[id]);
  const rawIndexEntries = useEntityStore((s) => s.indices[type]);

  // Early returns after all hooks
  if (!entityType || !entityId) return null;
  if (!config) {
    return (
      <div className="text-sm text-red-500">
        Unknown entity type: {entityType}
      </div>
    );
  }

  const entityComments = rawComments ?? [];
  const indexEntry = (rawIndexEntries ?? []).find((e) => e.entityId === entityId);

  if (!entity && !indexEntry) {
    return (
      <div className="text-sm text-gray-500 py-8">
        {config.label} not found.
      </div>
    );
  }

  const dataRoomId =
    (entity?.dataRoomId as string | undefined) ?? indexEntry?.dataRoomId;
  const commentsRoomId =
    (entity?.commentsRoomId as string | undefined) ??
    indexEntry?.commentsRoomId;

  const handleUpdate = async (data: Record<string, unknown>) => {
    if (!entity || !dataRoomId) return;
    const updated = { ...entity, ...data, updatedAt: new Date().toISOString() };
    await sendEntityUpdate(client, config!, dataRoomId, updated);
    upsertEntity(config!.type, entityId, updated);
  };

  const handlePostComment = async (body: string) => {
    if (!commentsRoomId) throw new Error("Comments room not found");
    await sendComment(client, commentsRoomId, entityId, body);
  };

  const displayName = entity
    ? config.displayNameFn(entity)
    : indexEntry?.displayName ?? config.label;

  const createdAt = entity?.createdAt as string | undefined;
  const createdBy = entity?.createdBy as string | undefined;

  const defaultValues = entity
    ? config.fields.reduce<Record<string, unknown>>((acc, f) => {
        acc[f.name] = entity[f.name];
        return acc;
      }, {})
    : undefined;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{displayName}</h1>
          <dl className="mt-1 space-y-0.5">
            {createdAt && (
              <div className="flex gap-2 text-xs text-gray-400">
                <dt>Created</dt>
                <dd>{new Date(createdAt).toLocaleString()}</dd>
              </div>
            )}
            {createdBy && (
              <div className="flex gap-2 text-xs text-gray-400">
                <dt>By</dt>
                <dd className="font-mono">{createdBy}</dd>
              </div>
            )}
          </dl>
        </div>
        <ShareDialog
          entityId={entityId}
          dataRoomId={dataRoomId}
          commentsRoomId={commentsRoomId}
        />
      </div>

      {entity ? (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Edit {config.label}
          </h2>
          <EntityForm
            key={entityId}
            config={config}
            defaultValues={defaultValues}
            onSubmit={handleUpdate}
            submitLabel={`Update ${config.label}`}
          />
        </section>
      ) : (
        <p className="text-sm text-gray-500">
          {config.label} data is still syncing...
        </p>
      )}

      {dataRoomId && (
        <SharedWithList
          dataRoomId={dataRoomId}
          commentsRoomId={commentsRoomId!}
        />
      )}

      {dataRoomId && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Documents
          </h2>
          <FileDropZone
            entityId={entityId}
            entityType={config.type}
            dataRoomId={dataRoomId}
          />
        </section>
      )}

      <section>
        <CommentsFeed
          comments={entityComments}
          onPostComment={handlePostComment}
        />
      </section>
    </div>
  );
}

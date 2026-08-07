import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDocsStore, type DocEntry, type DocTreeNode } from "@/stores/docs.store";
import { useAuthStore } from "@/stores/auth.store";
import { DocTreeItem, type DropIndicator, type DropZone } from "./DocTreeItem";
import { orderBetween } from "@/matrix/docs-matrix";

/** True if `docId` is `ancestorId` itself or a descendant of it — used to
 * refuse drops that would make a doc its own ancestor. */
function isDescendant(
  docs: DocEntry[],
  ancestorId: string,
  docId: string | null,
): boolean {
  let current = docId;
  while (current) {
    if (current === ancestorId) return true;
    current = docs.find((d) => d.docId === current)?.parentDocId ?? null;
  }
  return false;
}

/** Top/bottom edge of the hovered row reorders as a sibling; the middle
 * band nests the dragged doc as a child of the hovered row. */
function computeDropZone(
  event: Pick<DragOverEvent, "active" | "over">,
): DropIndicator | null {
  const { active, over } = event;
  if (!over || active.id === over.id) return null;
  const activeRect = active.rect.current.translated;
  const overRect = over.rect;
  if (!activeRect || !overRect) return null;
  const relativeY = (activeRect.top + activeRect.height / 2 - overRect.top) / overRect.height;
  const zone: DropZone = relativeY < 0.3 ? "before" : relativeY > 0.7 ? "after" : "nest";
  return { docId: String(over.id), zone };
}

/** Read-only tree item for shared documents — no dnd, no rename/create actions. */
function SharedDocTreeItem({
  node,
  depth = 0,
  onRemove,
  removingId,
}: {
  node: DocTreeNode;
  depth?: number;
  onRemove: (docId: string, title: string) => void;
  removingId: string | null;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showActions, setShowActions] = useState(false);
  const hasChildren = node.children.length > 0;
  const paddingLeft = 12 + depth * 16;
  const isRemoving = removingId === node.docId;

  return (
    <div>
      <div
        className="group flex items-center gap-1 pr-1 rounded hover:bg-gray-100"
        style={{ paddingLeft }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <button
          onClick={() => setIsExpanded((v) => !v)}
          className="flex-none w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 text-xs"
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : <span className="w-4" />}
        </button>
        <NavLink
          to={`/docs/${node.docId}`}
          className={({ isActive }) =>
            `flex-1 py-1.5 text-sm truncate ${
              isActive ? "text-blue-700 font-medium" : "text-gray-700 hover:text-gray-900"
            }`
          }
        >
          {node.title}
        </NavLink>
        {isRemoving ? (
          <span className="text-xs text-gray-400 flex-none">Removing…</span>
        ) : (
          showActions && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(node.docId, node.title);
              }}
              disabled={removingId !== null}
              className="p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 text-xs flex-none disabled:opacity-40"
              title="Remove from Shared with me"
            >
              ✕
            </button>
          )
        )}
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <SharedDocTreeItem
              key={child.docId}
              node={child}
              depth={depth + 1}
              onRemove={onRemove}
              removingId={removingId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DocTree() {
  const navigate = useNavigate();
  const client = useAuthStore((s) => s.client)!;
  const {
    docs,
    loading,
    createDoc,
    deleteDoc,
    removeSharedDoc,
    renameDoc,
    reorderDoc,
    moveDoc,
    getTree,
    getSharedTree,
  } = useDocsStore();

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [removingSharedId, setRemovingSharedId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const tree = getTree();
  const sharedTree = getSharedTree();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragOver = (event: DragOverEvent) => {
    setDropIndicator(computeDropZone(event));
  };

  const handleDragCancel = () => setDropIndicator(null);

  const handleDragEnd = async (event: DragEndEvent) => {
    setDropIndicator(null);
    const zoneInfo = computeDropZone(event);
    if (!zoneInfo) return;

    const activeDoc = docs.find((d) => d.docId === event.active.id);
    const overDoc = docs.find((d) => d.docId === zoneInfo.docId);
    if (!activeDoc || !overDoc) return;

    if (zoneInfo.zone === "nest") {
      // Dropped onto the middle of a row — nest as its last child.
      // Refuse if that row is the dragged doc itself or one of its own
      // descendants, which would create a cycle.
      if (isDescendant(docs, activeDoc.docId, overDoc.docId)) return;
      const children = docs
        .filter((d) => d.parentDocId === overDoc.docId)
        .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
      const newOrder = orderBetween(children.at(-1)?.order, undefined);
      await moveDoc(client, activeDoc.docId, overDoc.docId, newOrder);
      return;
    }

    // Dropped on the top/bottom edge — position as a sibling of the
    // hovered row, reparenting if it belongs to a different parent.
    const targetParentDocId = overDoc.parentDocId;
    if (isDescendant(docs, activeDoc.docId, targetParentDocId)) return;

    const siblings = docs
      .filter((d) => d.parentDocId === targetParentDocId && d.docId !== activeDoc.docId)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
    const overIndex = siblings.findIndex((d) => d.docId === overDoc.docId);
    const insertIndex = zoneInfo.zone === "before" ? overIndex : overIndex + 1;
    const newOrder = orderBetween(siblings[insertIndex - 1]?.order, siblings[insertIndex]?.order);

    if (targetParentDocId === activeDoc.parentDocId) {
      await reorderDoc(client, activeDoc.docId, newOrder);
    } else {
      await moveDoc(client, activeDoc.docId, targetParentDocId, newOrder);
    }
  };

  const handleCreateDoc = () => {
    const title = newTitle.trim() || "Untitled";
    setCreating(false);
    setNewTitle("");
    const entry = createDoc(client, title, null);
    navigate(`/docs/${entry.docId}`);
  };

  const handleAddChild = (parentDocId: string) => {
    const entry = createDoc(client, "Untitled", parentDocId);
    navigate(`/docs/${entry.docId}`);
  };

  const handleRemoveShared = async (docId: string, title: string) => {
    if (!confirm(`Remove "${title}" from Shared with me?`)) return;
    setRemovingSharedId(docId);
    try {
      // Awaited so the room-leave request has actually gone out before the
      // button clears — firing-and-forgetting it left a window where a
      // reload right after clicking could abort the request mid-flight,
      // leaving the doc still joined server-side and reappearing in Shared
      // with me until a later sync happened to correct it.
      await removeSharedDoc(client, docId);
    } finally {
      setRemovingSharedId(null);
    }
    navigate("/docs");
  };

  const rootIds = docs
    .filter((d) => !d.parentDocId)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .map((d) => d.docId);

  if (loading) {
    return (
      <div className="p-4 text-xs text-gray-400">Syncing documents...</div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Documents
        </span>
        <button
          onClick={() => setCreating(true)}
          className="text-gray-400 hover:text-gray-700 text-lg leading-none px-1"
          title="New document"
        >
          +
        </button>
      </div>

      {/* New doc input */}
      {creating && (
        <div className="px-3 py-1.5 border-b border-gray-100">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateDoc();
              if (e.key === "Escape") {
                setCreating(false);
                setNewTitle("");
              }
            }}
            onBlur={handleCreateDoc}
            placeholder="Page title..."
            className="w-full text-sm px-2 py-1 rounded border border-blue-400 outline-none"
          />
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 && !creating ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-gray-400 mb-3">No documents yet</p>
            <button
              onClick={() => setCreating(true)}
              className="text-xs text-blue-600 hover:underline"
            >
              Create your first document
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={rootIds}
              strategy={verticalListSortingStrategy}
            >
              {tree.map((node) => (
                <DocTreeItem
                  key={node.docId}
                  node={node}
                  depth={0}
                  dropIndicator={dropIndicator}
                  onRename={(id, title) => renameDoc(client, id, title)}
                  onDelete={(id) => deleteDoc(client, id)}
                  onAddChild={handleAddChild}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}

        {/* Shared with me */}
        {sharedTree.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="px-3 mb-1">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Shared with me
              </span>
            </div>
            {sharedTree.map((node) => (
              <SharedDocTreeItem
                key={node.docId}
                node={node}
                depth={0}
                onRemove={handleRemoveShared}
                removingId={removingSharedId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

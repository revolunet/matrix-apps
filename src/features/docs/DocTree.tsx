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
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDocsStore, type DocTreeNode } from "@/stores/docs.store";
import { useAuthStore } from "@/stores/auth.store";
import { DocTreeItem } from "./DocTreeItem";
import type { DocIndexEntry } from "@/matrix/docs-matrix";

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
    reorderDocs,
    getTree,
    getSharedTree,
  } = useDocsStore();

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [removingSharedId, setRemovingSharedId] = useState<string | null>(null);

  const tree = getTree();
  const sharedTree = getSharedTree();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Only handle root-level reordering for now
    const rootDocs = docs
      .filter((d) => !d.parentDocId)
      .sort((a, b) => a.order - b.order);

    const oldIndex = rootDocs.findIndex((d) => d.docId === active.id);
    const newIndex = rootDocs.findIndex((d) => d.docId === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = [...rootDocs];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    const updated: DocIndexEntry[] = reordered.map((d, i) => ({
      ...d,
      order: i,
    }));

    await reorderDocs(client, updated);
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
    .sort((a, b) => a.order - b.order)
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
            onDragEnd={handleDragEnd}
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

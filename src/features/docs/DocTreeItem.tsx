import { useState, useRef, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DocTreeNode } from "@/stores/docs.store";

interface Props {
  node: DocTreeNode;
  depth?: number;
  onRename: (docId: string, title: string) => void;
  onDelete: (docId: string) => void;
  onAddChild: (parentDocId: string) => void;
}

export function DocTreeItem({
  node,
  depth = 0,
  onRename,
  onDelete,
  onAddChild,
}: Props) {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.title);
  const [showActions, setShowActions] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.docId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== node.title) {
      onRename(node.docId, trimmed);
    }
    setIsRenaming(false);
  };

  const hasChildren = node.children.length > 0;
  const paddingLeft = 12 + depth * 16;

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className="group flex items-center gap-1 pr-1 rounded cursor-pointer hover:bg-gray-100"
        style={{ paddingLeft }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        {/* Drag handle */}
        <span
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-40 hover:!opacity-70 text-gray-400 cursor-grab text-xs select-none px-0.5"
          title="Drag to reorder"
        >
          ⠿
        </span>

        {/* Expand / collapse toggle */}
        <button
          onClick={() => setIsExpanded((v) => !v)}
          className="flex-none w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 text-xs"
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : <span className="w-4" />}
        </button>

        {/* Title / rename input */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") {
                setRenameValue(node.title);
                setIsRenaming(false);
              }
            }}
            className="flex-1 py-0.5 px-1 text-sm rounded border border-blue-400 outline-none min-w-0"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <NavLink
            to={`/docs/${node.docId}`}
            className={({ isActive }) =>
              `flex-1 py-1.5 text-sm truncate ${
                isActive
                  ? "text-blue-700 font-medium"
                  : "text-gray-700 hover:text-gray-900"
              }`
            }
            onDoubleClick={(e) => {
              e.preventDefault();
              setIsRenaming(true);
            }}
          >
            {node.title}
          </NavLink>
        )}

        {/* Hover actions */}
        {showActions && !isRenaming && (
          <div className="flex items-center gap-0.5 flex-none">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddChild(node.docId);
              }}
              className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 text-xs"
              title="New sub-page"
            >
              +
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setRenameValue(node.title);
                setIsRenaming(true);
              }}
              className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 text-xs"
              title="Rename"
            >
              ✎
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${node.title}" and all sub-pages?`)) {
                  onDelete(node.docId);
                  navigate("/docs");
                }
              }}
              className="p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 text-xs"
              title="Delete"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <DocTreeItem
              key={child.docId}
              node={child}
              depth={depth + 1}
              onRename={onRename}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}

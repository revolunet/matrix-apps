import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { ClientEvent, EventType, RoomMemberEvent, RoomStateEvent } from "matrix-js-sdk";
import type { MatrixEvent } from "matrix-js-sdk";
import { useAuthStore } from "@/stores/auth.store";
import { useDocsStore } from "@/stores/docs.store";
import { DOC_META_STATE_TYPE } from "@/matrix/docs-matrix";
import { DocTree } from "./DocTree";

const MIN_PANEL_WIDTH = 160;
const MAX_PANEL_WIDTH = 480;
const DEFAULT_PANEL_WIDTH = 260;

export function DocsLayout() {
  const client = useAuthStore((s) => s.client)!;
  const loadDocs = useDocsStore((s) => s.loadDocs);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(DEFAULT_PANEL_WIDTH);

  useEffect(() => {
    loadDocs(client);

    // Keep "Shared with me" live, and the tree's structure/order in sync
    // with m.space.child state written from other tabs/sessions (or as the
    // echo of our own optimistic writes). A newly shared doc only becomes
    // visible once its room shows up in client.getRooms(), our membership
    // syncs to "join", and its DOC_META_STATE_TYPE state event arrives —
    // each of which can land well after mount. Without this, loadDocs() is
    // only ever called once, so a share (or a remote reorder/move) sits
    // stale until the next remount.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        loadDocs(client);
      }, 300);
    };

    const onRoom = () => scheduleRefresh();
    const onMembership = () => scheduleRefresh();
    const onRoomState = (event: MatrixEvent) => {
      const type = event.getType();
      if (type === DOC_META_STATE_TYPE || type === EventType.SpaceChild) scheduleRefresh();
    };

    client.on(ClientEvent.Room, onRoom);
    client.on(RoomMemberEvent.Membership, onMembership);
    client.on(RoomStateEvent.Events, onRoomState);

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      client.off(ClientEvent.Room, onRoom);
      client.off(RoomMemberEvent.Membership, onMembership);
      client.off(RoomStateEvent.Events, onRoomState);
    };
  }, [client, loadDocs]);

  const onMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = panelWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      setPanelWidth(
        Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startWidth.current + delta)),
      );
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel: document tree */}
      <div
        className="flex-none border-r border-gray-200 bg-white overflow-hidden flex flex-col"
        style={{ width: panelWidth }}
      >
        <DocTree />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className="w-1 flex-none hover:bg-blue-200 cursor-col-resize transition-colors"
        role="separator"
        aria-label="Resize panel"
      />

      {/* Right area: editor / home */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}

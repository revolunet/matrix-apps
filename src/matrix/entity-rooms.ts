import type { MatrixClient } from "matrix-js-sdk";
import { Preset } from "matrix-js-sdk";
import type { EntityConfig } from "@/entities/types";

export interface EntityRooms {
  dataRoomId: string;
  commentsRoomId: string;
}

async function createEncryptedRoom(
  client: MatrixClient,
  name: string,
): Promise<string> {
  const resp = await client.createRoom({
    name,
    preset: Preset.PrivateChat,
    initial_state: [
      {
        type: "m.room.encryption",
        state_key: "",
        content: { algorithm: "m.megolm.v1.aes-sha2" },
      },
    ],
  });
  return resp.room_id;
}

export async function createEntityRooms(
  client: MatrixClient,
  config: EntityConfig,
  entityId: string,
): Promise<EntityRooms> {
  const dataRoomId = await createEncryptedRoom(
    client,
    config.roomNameFn(entityId),
  );
  await new Promise((r) => setTimeout(r, 500));
  const commentsRoomId = await createEncryptedRoom(
    client,
    config.roomNameFn(entityId, "comments"),
  );
  return { dataRoomId, commentsRoomId };
}

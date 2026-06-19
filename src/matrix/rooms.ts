import type { MatrixClient } from "matrix-js-sdk";
import { roomCommentsName, roomDataName } from "@/lib/constants";

export interface ContactRooms {
  dataRoomId: string;
  commentsRoomId: string;
}

async function createEncryptedRoom(
  client: MatrixClient,
  name: string,
): Promise<string> {
  const resp = await client.createRoom({
    name,
    preset: "private_chat" as const,
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

export async function createContactRooms(
  client: MatrixClient,
  contactId: string,
): Promise<ContactRooms> {
  const dataRoomId = await createEncryptedRoom(client, roomDataName(contactId));
  await new Promise((r) => setTimeout(r, 500));
  const commentsRoomId = await createEncryptedRoom(client, roomCommentsName(contactId));

  return { dataRoomId, commentsRoomId };
}

import { useRef, useState } from "react";
import { useShareContact } from "@/hooks/useShareContact";

interface Props {
  contactId: string;
}

export function ShareDialog({ contactId }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [matrixUserId, setMatrixUserId] = useState("");
  const { shareWith, sharing, error } = useShareContact(contactId);
  const [success, setSuccess] = useState(false);

  const open = () => {
    setMatrixUserId("");
    setSuccess(false);
    dialogRef.current?.showModal();
  };

  const close = () => {
    dialogRef.current?.close();
  };

  const handleShare = async () => {
    if (!matrixUserId.trim()) return;
    await shareWith(matrixUserId.trim());
    if (!error) {
      setSuccess(true);
    }
  };

  return (
    <>
      <button
        onClick={open}
        className="text-sm border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50"
      >
        Share
      </button>

      <dialog
        ref={dialogRef}
        className="rounded-lg p-6 w-full max-w-sm shadow-lg backdrop:bg-black/40"
      >
        <h2 className="text-base font-semibold mb-4">Share Contact</h2>

        {success ? (
          <div className="space-y-4">
            <p className="text-sm text-green-600">
              Invitation sent to {matrixUserId}
            </p>
            <button
              onClick={close}
              className="w-full bg-black text-white text-sm px-4 py-2 rounded hover:bg-gray-800"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Matrix User ID
              </label>
              <input
                type="text"
                value={matrixUserId}
                onChange={(e) => setMatrixUserId(e.target.value)}
                placeholder="@alice:matrix.org"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            {error && <p className="text-red-500 text-xs">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleShare}
                disabled={sharing || !matrixUserId.trim()}
                className="flex-1 bg-black text-white text-sm px-4 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
              >
                {sharing ? "Sharing..." : "Share"}
              </button>
              <button
                onClick={close}
                className="flex-1 text-sm border border-gray-300 px-4 py-2 rounded hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

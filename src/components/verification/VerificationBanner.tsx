import type { useVerification } from "@/hooks/useVerification";

// Takes the shared useVerification() return value as props rather than
// calling the hook itself — it must observe the same request Header's
// "Verify this device" button starts, not an independent instance.
export function VerificationBanner({
  verification,
  accept,
  decline,
  confirm,
  mismatch,
}: ReturnType<typeof useVerification>) {
  if (!verification) return null;

  const { step, otherUserId, otherDeviceId, isSelfVerification, sasData } =
    verification;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
      {/* Title bar */}
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800">
          {isSelfVerification ? "Device Verification" : "Identity Verification"}
        </span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            step === "done"
              ? "bg-green-100 text-green-700"
              : step === "cancelled"
                ? "bg-red-100 text-red-700"
                : step === "sas"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-yellow-100 text-yellow-700"
          }`}
        >
          {step}
        </span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Requesting party */}
        <p className="text-xs text-gray-500">
          <span className="font-mono text-gray-800">{otherUserId}</span>
          {otherDeviceId && (
            <span className="text-gray-400"> · device {otherDeviceId}</span>
          )}
        </p>

        {/* Step: incoming request */}
        {step === "requested" && (
          <>
            <p className="text-sm text-gray-700">
              {isSelfVerification
                ? "One of your other devices is requesting verification."
                : "This user wants to verify their identity with you."}
            </p>
            <div className="flex gap-2">
              <button
                onClick={accept}
                className="flex-1 bg-black text-white text-sm px-3 py-1.5 rounded hover:bg-gray-800"
              >
                Accept
              </button>
              <button
                onClick={decline}
                className="flex-1 text-sm border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50"
              >
                Decline
              </button>
            </div>
          </>
        )}

        {/* Step: waiting for verifier to start */}
        {step === "accepting" && (
          <p className="text-sm text-gray-500">Starting verification…</p>
        )}

        {/* Step: outgoing self-verification request, waiting on another device */}
        {step === "waiting" && (
          <>
            <p className="text-sm text-gray-700">
              Waiting for one of your other signed-in devices to accept…
            </p>
            <button
              onClick={decline}
              className="w-full text-sm border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
          </>
        )}

        {/* Step: SAS emoji comparison */}
        {step === "sas" && sasData && (
          <>
            <p className="text-sm text-gray-700">
              Compare these emoji with the other device. They must match exactly.
            </p>

            {sasData.emoji ? (
              <div className="grid grid-cols-4 gap-2 py-1">
                {sasData.emoji.map(([emoji, label], i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5">
                    <span className="text-2xl">{emoji}</span>
                    <span className="text-xs text-gray-500 text-center leading-tight">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            ) : sasData.decimal ? (
              <div className="flex gap-3 py-1 justify-center">
                {sasData.decimal.map((n, i) => (
                  <span
                    key={i}
                    className="text-xl font-mono font-semibold text-gray-900"
                  >
                    {n}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="flex gap-2">
              <button
                onClick={confirm}
                className="flex-1 bg-green-600 text-white text-sm px-3 py-1.5 rounded hover:bg-green-700"
              >
                They match
              </button>
              <button
                onClick={mismatch}
                className="flex-1 bg-red-600 text-white text-sm px-3 py-1.5 rounded hover:bg-red-700"
              >
                They don&apos;t match
              </button>
            </div>
          </>
        )}

        {/* Step: done */}
        {step === "done" && (
          <p className="text-sm text-green-700 font-medium">
            Verification complete. The device is now trusted.
          </p>
        )}

        {/* Step: cancelled */}
        {step === "cancelled" && (
          <p className="text-sm text-red-600">
            Verification was cancelled or failed.
          </p>
        )}
      </div>
    </div>
  );
}

import { useNavigate } from "react-router-dom";
import { useDocsStore } from "@/stores/docs.store";
import { useAuthStore } from "@/stores/auth.store";

export function DocsHomePage() {
  const navigate = useNavigate();
  const client = useAuthStore((s) => s.client)!;
  const { docs, createDoc } = useDocsStore();

  const handleCreate = () => {
    const entry = createDoc(client, "Untitled", null);
    navigate(`/docs/${entry.docId}`);
  };

  const recent = [...docs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 12);

  return (
    <div className="flex-1 overflow-y-auto p-10">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Documents</h1>
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <span className="text-base leading-none">+</span>
            New document
          </button>
        </div>

        {docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 mb-6 rounded-2xl bg-gray-100 flex items-center justify-center text-3xl">
              📄
            </div>
            <h2 className="text-lg font-medium text-gray-800 mb-2">
              No documents yet
            </h2>
            <p className="text-sm text-gray-500 mb-6 max-w-xs">
              Create your first document. It will be stored in an encrypted
              Matrix room, only accessible to you and the people you share it
              with.
            </p>
            <button
              onClick={handleCreate}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
            >
              Create your first document
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Recent
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {recent.map((doc) => (
                <button
                  key={doc.docId}
                  onClick={() => navigate(`/docs/${doc.docId}`)}
                  className="group text-left border border-gray-200 rounded-xl p-4 hover:border-gray-400 hover:shadow-sm transition-all"
                >
                  <div className="text-2xl mb-3">📄</div>
                  <div className="text-sm font-medium text-gray-900 truncate mb-1">
                    {doc.title}
                  </div>
                  <div className="text-xs text-gray-400">
                    {new Date(doc.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                </button>
              ))}

              <button
                onClick={handleCreate}
                className="text-left border border-dashed border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:bg-blue-50 transition-all group"
              >
                <div className="text-2xl mb-3 text-gray-300 group-hover:text-blue-400">
                  +
                </div>
                <div className="text-sm font-medium text-gray-400 group-hover:text-blue-600">
                  New document
                </div>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

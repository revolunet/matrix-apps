import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="max-w-lg w-full">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2 tracking-tight">
          Matrix CMS
        </h1>

        <p className="text-sm text-gray-500 mb-12 leading-relaxed">
          All data is stored in end-to-end encrypted{" "}
          <a
            href="https://matrix.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-700 underline underline-offset-2 hover:text-black"
          >
            Matrix
          </a>{" "}
          rooms. No application server, no database — your content lives
          entirely on a homeserver you control, encrypted at rest and in
          transit.
        </p>

        <div className="flex flex-col gap-3">
          <Link
            to="/contacts"
            className="group flex items-center justify-between border border-gray-200 rounded-lg px-5 py-4 hover:border-gray-400 transition-colors"
          >
            <div>
              <div className="text-sm font-medium text-gray-900">
                Manage project
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                Contacts, companies, trainings
              </div>
            </div>
            <span className="text-gray-300 group-hover:text-gray-500 transition-colors">
              →
            </span>
          </Link>

          <Link
            to="/docs"
            className="group flex items-center justify-between border border-gray-200 rounded-lg px-5 py-4 hover:border-gray-400 transition-colors"
          >
            <div>
              <div className="text-sm font-medium text-gray-900">
                Manage docs
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                Documents and knowledge base
              </div>
            </div>
            <span className="text-gray-300 group-hover:text-gray-500 transition-colors">
              →
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}

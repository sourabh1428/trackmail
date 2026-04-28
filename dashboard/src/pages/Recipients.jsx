import { useEffect, useState } from "react";
import api from "../api";
import RecipientTable from "../components/RecipientTable";

export default function Recipients() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/api/recipients")
      .then((r) => setRows(r.data))
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Recipients</h1>
        <p className="mt-1 text-sm text-slate-500">
          Search, filter, and update your outreach pipeline across every batch.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      {loading ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-slate-400">Loading recipients...</div>
      ) : (
        <RecipientTable rows={rows} />
      )}
    </div>
  );
}

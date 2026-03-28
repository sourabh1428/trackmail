import { useEffect, useState } from "react";
import api from "../api";

export default function BunchSelector({ value, onChange }) {
  const [bunches, setBunches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/api/bunches")
      .then(r => {
        setBunches(r.data);
        if (r.data.length > 0 && !value) onChange(r.data[0].bunch_id);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-400 text-sm">Loading batches…</div>;

  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-slate-400">Batch:</label>
      <select
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
      >
        {bunches.map(b => (
          <option key={b.bunch_id} value={b.bunch_id}>
            {b.bunch_id} ({b.sent} sent)
          </option>
        ))}
      </select>
    </div>
  );
}

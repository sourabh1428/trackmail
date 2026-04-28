import { useEffect, useState } from "react";
import api from "../api";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatBunchId(id) {
  if (!id || id.length !== 6) return id;
  const day   = parseInt(id.slice(0, 2), 10);
  const month = parseInt(id.slice(2, 4), 10) - 1;
  const year  = "20" + id.slice(4, 6);
  if (month < 0 || month > 11 || isNaN(day)) return id;
  return `${day} ${MONTHS[month]} ${year}`;
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

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
  }, [onChange]);

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">Loading campaigns…</span>
      </div>
    );
  }

  if (!bunches.length) {
    return <span className="text-xs text-slate-500">No campaigns found</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 font-medium">Campaign</span>
      <div className="relative">
        <select
          value={value || ""}
          onChange={e => onChange(e.target.value)}
          className="appearance-none bg-slate-800 border border-slate-700 rounded-lg pl-3 pr-8 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 cursor-pointer transition-colors hover:border-slate-600"
        >
          {bunches.map(b => (
            <option key={b.bunch_id} value={b.bunch_id}>
              {formatBunchId(b.bunch_id)} — {b.sent} sent
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
          <ChevronIcon />
        </div>
      </div>
    </div>
  );
}

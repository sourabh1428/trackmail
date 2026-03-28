import { useState, useMemo } from "react";

const PAGE_SIZE = 50;

function Badge({ value }) {
  return value
    ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400">✓</span>
    : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-500">—</span>;
}

export default function RecipientTable({ rows = [] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("sentAt");
  const [sortDir, setSortDir] = useState(-1);
  const [page, setPage] = useState(0);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(-1); }
    setPage(0);
  }

  const filtered = useMemo(() =>
    rows.filter(r => r.email.toLowerCase().includes(search.toLowerCase())),
    [rows, search]
  );

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "boolean") return sortDir * (Number(av) - Number(bv));
      return sortDir * (new Date(av) - new Date(bv));
    }),
    [filtered, sortKey, sortDir]
  );

  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  const Th = ({ col, label }) => (
    <th
      onClick={() => toggleSort(col)}
      className="px-3 py-2 text-left text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:text-white select-none"
    >
      {label} {sortKey === col ? (sortDir === -1 ? "↓" : "↑") : ""}
    </th>
  );

  return (
    <div className="space-y-3">
      <input
        value={search}
        onChange={e => { setSearch(e.target.value); setPage(0); }}
        placeholder="Filter by email…"
        className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white w-64 focus:outline-none focus:border-blue-500"
      />
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-800">
            <tr>
              <Th col="email" label="Email" />
              <Th col="sentAt" label="Sent At" />
              <Th col="opened" label="Opened" />
              <Th col="clicked" label="Clicked" />
              <Th col="cameBack" label="Came Back" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {pageRows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-800/50">
                <td className="px-3 py-2 text-slate-300">{r.email}</td>
                <td className="px-3 py-2 text-slate-400">{r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}</td>
                <td className="px-3 py-2"><Badge value={r.opened} /></td>
                <td className="px-3 py-2"><Badge value={r.clicked} /></td>
                <td className="px-3 py-2"><Badge value={r.cameBack} /></td>
              </tr>
            ))}
            {!pageRows.length && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No recipients found</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 bg-slate-700 rounded disabled:opacity-40">← Prev</button>
          <span>Page {page + 1} of {totalPages} ({sorted.length} rows)</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1 bg-slate-700 rounded disabled:opacity-40">Next →</button>
        </div>
      )}
    </div>
  );
}

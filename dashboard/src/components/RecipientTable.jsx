import { useMemo, useState } from "react";
import api from "../api";

const PAGE_SIZE = 50;
const STAGES = ["all", "sent", "opened", "clicked", "replied", "interview_scheduled", "offer", "rejected"];
const STAGE_LABELS = {
  sent: "Sent",
  opened: "Opened",
  clicked: "Clicked",
  replied: "Replied",
  interview_scheduled: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};
const STAGE_CLASSES = {
  sent: "bg-slate-700 text-slate-200",
  opened: "bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/20",
  clicked: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20",
  replied: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20",
  interview_scheduled: "bg-purple-500/15 text-purple-300 ring-1 ring-purple-500/20",
  offer: "bg-emerald-600/20 text-emerald-200 ring-1 ring-emerald-500/30",
  rejected: "bg-red-500/15 text-red-300 ring-1 ring-red-500/20",
};

function domainFromEmail(email = "") {
  return email.includes("@") ? email.split("@")[1] : "";
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "-";
}

function formatActivity(value) {
  if (!value) return "-";
  const diff = Date.now() - new Date(value).getTime();
  const hours = Math.max(1, Math.round(diff / (60 * 60 * 1000)));
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function StageBadge({ stage }) {
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${STAGE_CLASSES[stage] || STAGE_CLASSES.sent}`}>
      {STAGE_LABELS[stage] || stage}
    </span>
  );
}

export default function RecipientTable({ rows = [] }) {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [batch, setBatch] = useState("all");
  const [sort, setSort] = useState({ key: "lastActivity", dir: -1 });
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState("");

  const batches = useMemo(() => [...new Set(rows.map((r) => r.bunchId).filter(Boolean))].sort().reverse(), [rows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((row) => {
      const matchesSearch = !q
        || row.email?.toLowerCase().includes(q)
        || row.company?.toLowerCase().includes(q)
        || domainFromEmail(row.email).toLowerCase().includes(q);
      const matchesStage = stage === "all" || row.stage === stage;
      const matchesBatch = batch === "all" || row.bunchId === batch;
      return matchesSearch && matchesStage && matchesBatch;
    });
  }, [rows, search, stage, batch]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    if (sort.key === "company" || sort.key === "email" || sort.key === "stage") {
      return sort.dir * String(av || "").localeCompare(String(bv || ""));
    }
    if (sort.key === "openCount" || sort.key === "followUpNumber") {
      return sort.dir * ((av || 0) - (bv || 0));
    }
    return sort.dir * (new Date(av || 0) - new Date(bv || 0));
  }), [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function updateSort(key) {
    setSort((current) => current.key === key ? { key, dir: current.dir * -1 } : { key, dir: -1 });
  }

  async function logReply(row) {
    const notes = prompt(`Reply notes for ${row.email}:`);
    if (notes === null) return;
    await api.post("/api/replies", { email: row.email, notes, sentiment: "positive", stage: "replied" });
    setMessage(`Logged reply for ${row.email}. Refresh to see the updated stage.`);
  }

  async function moveStage(row) {
    const next = prompt("Move to stage: replied, interview_scheduled, offer, rejected", row.stage);
    if (!next) return;
    await api.put(`/api/recipients/${encodeURIComponent(row.email)}/stage`, { stage: next });
    setMessage(`Updated ${row.email} to ${next}. Refresh to see the updated stage.`);
  }

  function Th({ col, label, right = false }) {
    return (
      <th onClick={() => updateSort(col)} className={`cursor-pointer whitespace-nowrap px-3 py-3 text-xs font-medium uppercase text-slate-500 hover:text-slate-300 ${right ? "text-right" : "text-left"}`}>
        {label} {sort.key === col ? (sort.dir === -1 ? "down" : "up") : ""}
      </th>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search email, company, domain"
          className="min-w-64 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-blue-500"
        />
        <select value={stage} onChange={(e) => { setStage(e.target.value); setPage(0); }} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200">
          {STAGES.map((item) => <option key={item} value={item}>{item === "all" ? "All stages" : STAGE_LABELS[item]}</option>)}
        </select>
        <select value={batch} onChange={(e) => { setBatch(e.target.value); setPage(0); }} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200">
          <option value="all">All batches</option>
          {batches.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      {message && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{message}</div>}

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/80">
            <tr>
              <Th col="email" label="Email" />
              <Th col="company" label="Company" />
              <Th col="stage" label="Stage" />
              <Th col="lastActivity" label="Last Activity" />
              <Th col="openCount" label="Opens" right />
              <Th col="followUpNumber" label="Follow-up #" right />
              <Th col="templateId" label="Template" />
              <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.email} className="border-b border-slate-800/70 hover:bg-slate-800/40">
                <td className="max-w-72 truncate px-3 py-3 text-slate-100">{row.email}</td>
                <td className="px-3 py-3 text-slate-400">{row.company || domainFromEmail(row.email)}</td>
                <td className="px-3 py-3"><StageBadge stage={row.stage} /></td>
                <td className="px-3 py-3 text-slate-400">{formatActivity(row.lastActivity || row.sentAt)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-300">{row.openCount || 0}</td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-300">{row.followUpNumber || 0}</td>
                <td className="px-3 py-3 text-slate-500">{row.templateId || "-"}</td>
                <td className="px-3 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => logReply(row)} className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700">Log Reply</button>
                    <button onClick={() => moveStage(row)} className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700">Move</button>
                    <a className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700" href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(row.email)}`} target="_blank" rel="noreferrer">Gmail</a>
                  </div>
                </td>
              </tr>
            ))}
            {!pageRows.length && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-slate-500">No recipients match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>Showing {pageRows.length ? page * PAGE_SIZE + 1 : 0}-{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}</span>
        <div className="flex items-center gap-2">
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="rounded-md border border-slate-700 px-3 py-1.5 disabled:opacity-40">Previous</button>
          <span>{page + 1} / {totalPages}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} className="rounded-md border border-slate-700 px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState, useCallback } from "react";
import api from "../api";
import BunchSelector from "../components/BunchSelector";

const CONDITION_TYPES = [
  { value: "opened",       label: "Opened email" },
  { value: "clicked",      label: "Clicked any link" },
  { value: "clicked_link", label: "Clicked specific link" },
  { value: "came_back",    label: "Came back to site" },
  { value: "replied",      label: "Replied" },
  { value: "domain",       label: "Domain" },
];

const OPERATORS_COUNT = [
  { value: "gte",   label: "at least" },
  { value: "eq",    label: "exactly" },
  { value: "never", label: "never" },
];

const OPERATORS_DOMAIN = [
  { value: "contains", label: "contains" },
  { value: "eq",       label: "equals" },
];

function newCondition() {
  return { id: Math.random().toString(36).slice(2), type: "opened", operator: "gte", value: "1", url: "", boolValue: true };
}

function eventColor(event) {
  if (event === "open")     return { dot: "bg-emerald-400", text: "text-emerald-300", label: "Email opened" };
  if (event === "click")    return { dot: "bg-amber-400",   text: "text-amber-300",   label: "Clicked link"  };
  if (event === "comeback") return { dot: "bg-purple-400",  text: "text-purple-300",  label: "Came back"     };
  return { dot: "bg-slate-400", text: "text-slate-300", label: event };
}

function formatIST(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function exportCSV(results) {
  const rows = [["email", "opens", "clicks", "replied"], ...results.map((r) => [r.email, r.openCount, r.clickCount, r.replied])];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "trackmail-query-results.csv";
  a.click();
}

export default function Explore() {
  const [bunchId, setBunchId] = useState("");
  const [conditions, setConditions] = useState([newCondition()]);
  const [availableLinks, setAvailableLinks] = useState([]);
  const [results, setResults] = useState(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState("");
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  useEffect(() => {
    const url = bunchId
      ? `/api/explore/links?bunchId=${encodeURIComponent(bunchId)}`
      : "/api/explore/links";
    api.get(url).then((r) => setAvailableLinks(r.data || [])).catch(() => setAvailableLinks([]));
  }, [bunchId]);

  useEffect(() => {
    if (!selectedEmail) { setTimeline([]); return; }
    setTimelineLoading(true);
    const url = bunchId
      ? `/api/explore/timeline?email=${encodeURIComponent(selectedEmail)}&bunchId=${encodeURIComponent(bunchId)}`
      : `/api/explore/timeline?email=${encodeURIComponent(selectedEmail)}`;
    api.get(url)
      .then((r) => setTimeline(r.data || []))
      .catch(() => setTimeline([]))
      .finally(() => setTimelineLoading(false));
  }, [selectedEmail, bunchId]);

  const addCondition = () => setConditions((c) => [...c, newCondition()]);
  const removeCondition = (id) => setConditions((c) => c.filter((x) => x.id !== id));
  const updateCondition = (id, patch) =>
    setConditions((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const runQuery = useCallback(async () => {
    setQueryLoading(true);
    setQueryError("");
    setResults(null);
    setSelectedEmail(null);
    try {
      const payload = {
        bunchId: bunchId || undefined,
        conditions: conditions.map((c) => {
          if (c.type === "clicked_link") return { type: c.type, url: c.url };
          if (c.type === "came_back" || c.type === "replied") return { type: c.type, value: c.boolValue };
          if (c.type === "domain") return { type: c.type, operator: c.operator, value: c.value };
          if (c.operator === "never") return { type: c.type, operator: "never" };
          return { type: c.type, operator: c.operator, value: c.value };
        }),
      };
      const { data } = await api.post("/api/explore/query", payload);
      setResults(data);
    } catch (e) {
      setQueryError(e.response?.data?.error || e.message);
    } finally {
      setQueryLoading(false);
    }
  }, [conditions, bunchId]);

  const selectUser = (email) => setSelectedEmail((prev) => (prev === email ? null : email));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Explore</h1>
          <p className="mt-1 text-sm text-slate-500">Query recipients by behavior. Click a result to see their full event timeline.</p>
        </div>
        <BunchSelector value={bunchId} onChange={setBunchId} />
      </div>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white">Filter users</h2>
        <p className="text-xs text-slate-500">All conditions must match (AND logic)</p>

        {conditions.map((cond) => (
          <div key={cond.id} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-700 bg-slate-950 p-2">
            <select
              value={cond.type}
              onChange={(e) => updateCondition(cond.id, { type: e.target.value, operator: "gte", value: "1", url: "", boolValue: true })}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-blue-300 focus:outline-none focus:border-blue-500"
            >
              {CONDITION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>

            {(cond.type === "opened" || cond.type === "clicked") && (
              <>
                <select
                  value={cond.operator}
                  onChange={(e) => updateCondition(cond.id, { operator: e.target.value })}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {OPERATORS_COUNT.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {cond.operator !== "never" && (
                  <input
                    type="number"
                    min="1"
                    value={cond.value}
                    onChange={(e) => updateCondition(cond.id, { value: e.target.value })}
                    className="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                )}
                {cond.operator !== "never" && <span className="text-xs text-slate-500">times</span>}
              </>
            )}

            {cond.type === "clicked_link" && (
              <select
                value={cond.url}
                onChange={(e) => updateCondition(cond.id, { url: e.target.value })}
                className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">— select URL —</option>
                {availableLinks.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            )}

            {(cond.type === "came_back" || cond.type === "replied") && (
              <select
                value={String(cond.boolValue)}
                onChange={(e) => updateCondition(cond.id, { boolValue: e.target.value === "true" })}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="true">yes</option>
                <option value="false">no</option>
              </select>
            )}

            {cond.type === "domain" && (
              <>
                <select
                  value={cond.operator}
                  onChange={(e) => updateCondition(cond.id, { operator: e.target.value })}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {OPERATORS_DOMAIN.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input
                  type="text"
                  placeholder="example.com"
                  value={cond.value}
                  onChange={(e) => updateCondition(cond.id, { value: e.target.value })}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </>
            )}

            {conditions.length > 1 && (
              <button
                onClick={() => removeCondition(cond.id)}
                className="ml-auto text-slate-600 hover:text-red-400 transition-colors"
              >✕</button>
            )}
          </div>
        ))}

        <div className="flex items-center gap-3">
          <button
            onClick={addCondition}
            className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >+ Add condition</button>
          <button
            onClick={runQuery}
            disabled={queryLoading}
            className="ml-auto rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {queryLoading ? "Running…" : "Run query →"}
          </button>
        </div>

        {queryError && (
          <p className="text-sm text-red-400">{queryError}</p>
        )}
      </section>

      {results !== null && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <span className="text-sm font-semibold text-white">
                {results.length} {results.length === 1 ? "user" : "users"} matched
              </span>
              {results.length > 0 && (
                <button
                  onClick={() => exportCSV(results)}
                  className="rounded-md bg-emerald-600/20 border border-emerald-500/30 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-600/30 transition-colors"
                >
                  ⬇ Export CSV
                </button>
              )}
            </div>
            {results.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">No users matched the conditions.</p>
            ) : (
              <div className="divide-y divide-slate-800">
                {results.map((r) => (
                  <button
                    key={r.email}
                    onClick={() => selectUser(r.email)}
                    className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                      selectedEmail === r.email
                        ? "bg-blue-500/10 border-l-2 border-blue-500"
                        : "hover:bg-slate-800/50"
                    }`}
                  >
                    <span className={`text-sm truncate ${selectedEmail === r.email ? "text-white" : "text-blue-300"}`}>
                      {r.email}
                    </span>
                    <span className="ml-3 shrink-0 text-xs text-slate-500">
                      {r.openCount} open{r.openCount !== 1 ? "s" : ""}
                      {r.clickCount > 0 ? ` · ${r.clickCount} click${r.clickCount !== 1 ? "s" : ""}` : ""}
                      {r.replied ? " · replied" : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
            {!selectedEmail ? (
              <div className="flex h-full min-h-[200px] items-center justify-center p-8 text-sm text-slate-500">
                Click a user to see their behavior timeline
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-slate-800">
                  <p className="text-sm font-semibold text-white truncate">{selectedEmail}</p>
                  <p className="text-xs text-slate-500">behavior timeline</p>
                </div>
                {timelineLoading ? (
                  <p className="p-6 text-sm text-slate-500">Loading…</p>
                ) : timeline.length === 0 ? (
                  <p className="p-6 text-sm text-slate-500">No events recorded yet.</p>
                ) : (
                  <div className="p-4 space-y-0">
                    <div className="ml-3 border-l border-slate-700 pl-4 space-y-4">
                      {timeline.map((ev, i) => {
                        const { dot, text, label } = eventColor(ev.event);
                        return (
                          <div key={i} className="relative">
                            <span className={`absolute -left-6 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-slate-900 ${dot}`} />
                            <p className={`text-sm font-medium ${text}`}>{label}</p>
                            <p className="text-xs text-slate-500">{formatIST(ev.timestamp)}</p>
                            {ev.url && (
                              <p className="mt-0.5 truncate rounded bg-slate-950 px-2 py-0.5 text-xs text-slate-400 inline-block max-w-full">
                                → {ev.url}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

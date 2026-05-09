import { useEffect, useRef, useState } from "react";
import api from "../api";

export default function Scraper() {
  // Section A state
  const [links, setLinks] = useState([]);
  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [linksError, setLinksError] = useState("");
  const [saving, setSaving] = useState(false);

  // Section B state
  const [status, setStatus] = useState("idle"); // "idle" | "running"
  const [runId, setRunId] = useState(null);
  const [runError, setRunError] = useState("");

  // Section C state
  const [logLines, setLogLines] = useState([]);
  const logRef = useRef(null);
  const readerRef = useRef(null);

  // Load links on mount + poll scraper status
  useEffect(() => {
    loadLinks();
    loadStatus();
  }, []);

  // Poll status every 5s while running
  useEffect(() => {
    if (status !== "running") return;
    const timer = setTimeout(loadStatus, 5000);
    return () => clearTimeout(timer);
  }, [status]);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  async function loadLinks() {
    try {
      const r = await api.get("/api/scraper/links");
      setLinks(r.data);
    } catch (e) {
      setLinksError(e.response?.data?.error || e.message);
    }
  }

  async function loadStatus() {
    try {
      const r = await api.get("/api/scraper/status");
      setStatus(r.data.status);
      if (r.data.runId && r.data.status === "running") setRunId(String(r.data.runId));
    } catch {}
  }

  async function addLink() {
    setLinksError("");
    if (!newUrl.startsWith("https://www.linkedin.com/search/results/")) {
      setLinksError("URL must be a LinkedIn search results URL");
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/scraper/links", { url: newUrl, label: newLabel });
      setNewUrl("");
      setNewLabel("");
      await loadLinks();
    } catch (e) {
      setLinksError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteLink(id) {
    try {
      await api.delete(`/api/scraper/links/${id}`);
      await loadLinks();
    } catch (e) {
      setLinksError(e.response?.data?.error || e.message);
    }
  }

  async function toggleLink(link) {
    try {
      await api.patch(`/api/scraper/links/${link._id}`, { enabled: !link.enabled });
      await loadLinks();
    } catch (e) {
      setLinksError(e.response?.data?.error || e.message);
    }
  }

  async function runScraper() {
    setRunError("");
    setLogLines([]);
    try {
      const r = await api.post("/api/scraper/run");
      setRunId(r.data.runId);
      setStatus("running");
      streamLogs(r.data.runId);
    } catch (e) {
      setRunError(e.response?.data?.error || e.message);
    }
  }

  async function streamLogs(id) {
    const token = localStorage.getItem("trackmail_token");
    try {
      const resp = await fetch(`/api/scraper/logs/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) { setRunError("Failed to connect to log stream"); return; }
      const reader = resp.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop();
        for (const part of parts) {
          if (part.startsWith("data: ")) {
            try {
              const payload = JSON.parse(part.slice(6));
              if (payload.line) setLogLines(prev => [...prev, payload.line]);
            } catch {}
          }
          if (part.startsWith("event: done")) {
            setStatus("idle");
            return;
          }
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") setRunError(e.message);
    } finally {
      setStatus("idle");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-white">Scraper</h1>
        <p className="mt-1 text-sm text-slate-500">Manage LinkedIn search URLs and run the scraper.</p>
      </div>

      {/* Section A: Search URL Manager */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-4 text-sm font-semibold text-white">Search URLs</h2>
        {linksError && (
          <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-300">{linksError}</div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Label</th>
                <th className="pb-2 font-medium">URL</th>
                <th className="pb-2 font-medium text-center">Enabled</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {links.map(link => (
                <tr key={link._id} className="border-t border-slate-800/60">
                  <td className="py-2 pr-4 text-slate-300">{link.label || "—"}</td>
                  <td className="py-2 pr-4 text-slate-400 max-w-xs">
                    <span className="block truncate" title={link.url}>{link.url}</span>
                  </td>
                  <td className="py-2 text-center">
                    <input
                      type="checkbox"
                      checked={link.enabled}
                      onChange={() => toggleLink(link)}
                      className="accent-blue-500 cursor-pointer"
                    />
                  </td>
                  <td className="py-2 pl-4">
                    <button
                      onClick={() => deleteLink(link._id)}
                      className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!links.length && (
                <tr><td colSpan={4} className="py-6 text-center text-sm text-slate-500">No URLs yet. Add one below.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add form */}
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="https://www.linkedin.com/search/results/..."
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            className="flex-1 min-w-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Label (optional)"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            className="w-40 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={addLink}
            disabled={saving || !newUrl}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Adding…" : "Add"}
          </button>
        </div>
      </section>

      {/* Section B: Run Controls */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Run Scraper</h2>
            <p className="mt-1 text-xs text-slate-500">
              {status === "running" ? "Scraper is running…" : "Scraper is idle."}
            </p>
          </div>
          <button
            onClick={runScraper}
            disabled={status === "running"}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {status === "running" ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Running…
              </>
            ) : "Run Scraper"}
          </button>
        </div>
        {runError && (
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-300">{runError}</div>
        )}
      </section>

      {/* Section C: Live Log Stream */}
      {(logLines.length > 0 || status === "running") && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-3 text-sm font-semibold text-white">Live Logs</h2>
          <pre
            ref={logRef}
            className="overflow-y-auto max-h-96 font-mono text-xs text-green-400 bg-slate-950 rounded-xl border border-slate-800 p-4 whitespace-pre-wrap"
          >
            {logLines.join("\n") || "Waiting for output…"}
          </pre>
        </section>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import api from "../api";

const CREDENTIAL_FIELDS = {
  ses: [
    { key: "accessKeyId", label: "Access Key ID", type: "text" },
    { key: "secretAccessKey", label: "Secret Access Key", type: "password" },
    { key: "region", label: "Region", type: "text", placeholder: "ap-south-1" },
    { key: "fromEmail", label: "From Email", type: "email" },
  ],
  resend: [
    { key: "apiKey", label: "API Key", type: "password" },
  ],
};
const GMAIL_FIELDS = [
  { key: "email", label: "Email Address", type: "email" },
  { key: "appPassword", label: "App Password", type: "password" },
];
["gmail", "gmail2", "gmail3", "gmail4"].forEach(n => { CREDENTIAL_FIELDS[n] = GMAIL_FIELDS; });

function ConnectorCard({ connector, onSaved }) {
  const [enabled, setEnabled] = useState(connector.enabled);
  const [dailyLimit, setDailyLimit] = useState(String(connector.dailyLimit || ""));
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [showCreds, setShowCreds] = useState(false);
  const [creds, setCreds] = useState({});
  const [credMsg, setCredMsg] = useState("");
  const [credSaving, setCredSaving] = useState(false);

  const fields = CREDENTIAL_FIELDS[connector.name] || [];

  async function saveConfig() {
    setSaving(true);
    setSaveMsg("");
    try {
      await api.put(`/api/connectors/${connector.name}`, {
        enabled,
        dailyLimit: parseInt(dailyLimit, 10),
      });
      setSaveMsg("Saved");
      onSaved();
    } catch (e) {
      setSaveMsg(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  }

  async function saveCreds() {
    setCredSaving(true);
    setCredMsg("");
    try {
      await api.put(`/api/connectors/${connector.name}/credentials`, creds);
      setCredMsg("Credentials saved");
      setCreds({});
    } catch (e) {
      setCredMsg(e.response?.data?.error || e.message);
    } finally {
      setCredSaving(false);
    }
  }

  async function clearCreds() {
    if (!window.confirm(`Clear credentials for ${connector.name}?`)) return;
    setCredMsg("");
    try {
      await api.delete(`/api/connectors/${connector.name}/credentials`);
      setCredMsg("Credentials cleared");
    } catch (e) {
      setCredMsg(e.response?.data?.error || e.message);
    }
  }

  const pct = connector.dailyLimit > 0 ? Math.round((connector.sentToday / connector.dailyLimit) * 100) : 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white uppercase tracking-wide text-sm">{connector.name}</span>
            <span className={`rounded-md px-1.5 py-0.5 text-xs ${connector.enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-700 text-slate-400"}`}>
              {connector.enabled ? "enabled" : "disabled"}
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {connector.sentToday} / {connector.dailyLimit} sent today
          </div>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Config row */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="accent-blue-500 cursor-pointer"
          />
          Enabled
        </label>
        <input
          type="number"
          min="1"
          value={dailyLimit}
          onChange={e => setDailyLimit(e.target.value)}
          placeholder="Daily limit"
          className="w-28 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={saveConfig}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saveMsg && <span className={`text-xs ${saveMsg === "Saved" ? "text-emerald-400" : "text-red-400"}`}>{saveMsg}</span>}
        <button
          onClick={() => { setShowCreds(v => !v); setCredMsg(""); }}
          className="ml-auto text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          {showCreds ? "Hide Credentials" : "Edit Credentials"}
        </button>
      </div>

      {/* Credentials form */}
      {showCreds && fields.length > 0 && (
        <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
          <p className="text-xs text-slate-500">Credentials are stored securely and never returned by the API.</p>
          {fields.map(f => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">{f.label}</label>
              <input
                type={f.type}
                placeholder={f.placeholder || ""}
                value={creds[f.key] || ""}
                onChange={e => setCreds(prev => ({ ...prev, [f.key]: e.target.value }))}
                autoComplete="off"
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              onClick={saveCreds}
              disabled={credSaving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {credSaving ? "Saving…" : "Save Credentials"}
            </button>
            <button
              onClick={clearCreds}
              className="rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Clear
            </button>
          </div>
          {credMsg && (
            <p className={`text-xs ${credMsg.includes("saved") || credMsg.includes("cleared") ? "text-emerald-400" : "text-red-400"}`}>
              {credMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Connectors() {
  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    try {
      const r = await api.get("/api/connectors");
      setConnectors(r.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-slate-400">Loading connectors…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Connectors</h1>
        <p className="mt-1 text-sm text-slate-500">Manage email sending connectors, daily limits, and credentials.</p>
      </div>
      {error && <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {connectors.map(c => <ConnectorCard key={c.name} connector={c} onSaved={load} />)}
        {!connectors.length && !error && (
          <div className="col-span-full py-12 text-center text-sm text-slate-500">No connectors configured yet.</div>
        )}
      </div>
    </div>
  );
}

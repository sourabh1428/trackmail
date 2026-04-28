import { useState, useEffect, useCallback } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import api from "../api";
import TemplateEditor from "../components/TemplateEditor";

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);

  const loadList = useCallback(() => {
    api.get("/api/templates").then(r => setTemplates(r.data)).catch(console.error);
    api.get("/api/template-comparison").then(r => setPerformance(r.data)).catch(console.error);
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  async function selectTemplate(tmpl) {
    try {
      const res = await api.get(`/api/templates/${tmpl._id}`);
      setSelected({ ...tmpl, html: res.data.html ?? "" });
    } catch (e) { console.error(e); setSelected({ ...tmpl, html: "" }); }
  }

  async function createNew() {
    const name = prompt("Template name:");
    if (!name) return;
    setCreating(true);
    try {
      let baseHtml = "";
      const active = templates.find(t => t.isActive);
      if (active) {
        const res = await api.get("/api/templates/active");
        baseHtml = res.data.html;
      }
      await api.post("/api/templates", { name, html: baseHtml });
      loadList();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally { setCreating(false); }
  }

  const handleActivated = async () => {
    loadList();
    try {
      const res = await api.get("/api/templates/active");
      setSelected(prev => prev ? { ...prev, isActive: true, html: res.data.html ?? "" } : null);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Templates</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage your email templates</p>
        </div>
        <button
          onClick={createNew}
          disabled={creating}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          <span className="text-lg leading-none">+</span> New Template
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold text-white">Template Performance</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {performance.map((row, index) => (
                  <tr key={row.template} className="border-t border-slate-800 first:border-t-0">
                    <td className="py-2 text-slate-300">{row.template}{index === 0 && performance.length > 1 ? " - Winner" : ""}</td>
                    <td className="py-2 text-right text-slate-500">{row.timesUsed} used</td>
                    <td className="py-2 text-right text-slate-300">{row.openRate}% open</td>
                    <td className="py-2 text-right text-slate-300">{row.replyRate}% reply</td>
                  </tr>
                ))}
                {!performance.length && <tr><td className="py-6 text-center text-slate-500">No template usage data yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold text-white">Rate Comparison</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={performance}>
              <XAxis dataKey="template" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#020617", border: "1px solid #1e293b", color: "#fff" }} />
              <Bar dataKey="openRate" fill="#60a5fa" />
              <Bar dataKey="clickRate" fill="#f59e0b" />
              <Bar dataKey="replyRate" fill="#22c55e" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" style={{ minHeight: "60vh" }}>
        <div className="md:col-span-1 bg-slate-900 rounded-xl border border-slate-800 p-2 space-y-0.5 overflow-y-auto">
          {!templates.length && (
            <div className="text-slate-500 text-sm text-center py-10">No templates yet</div>
          )}
          {templates.map(t => (
            <button
              key={t._id}
              onClick={() => selectTemplate(t)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                selected?._id === t._id
                  ? "bg-slate-700/80 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{t.name}</span>
                {t.isActive && (
                  <span className="ml-2 shrink-0 px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 text-xs rounded-md ring-1 ring-emerald-500/20">
                    Active
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        <div className="md:col-span-2 bg-slate-900 rounded-xl border border-slate-800 p-5">
          {selected && !selected.isActive && !selected.html && (
            <div className="mb-4 flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5">
              <span>⚠</span>
              HTML editing is only available for the active template. Activate this template to edit its HTML.
            </div>
          )}
          <TemplateEditor
            template={selected}
            onSaved={loadList}
            onActivated={handleActivated}
            onDeleted={() => { setSelected(null); loadList(); }}
          />
        </div>
      </div>
    </div>
  );
}

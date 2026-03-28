import { useState, useEffect, useCallback } from "react";
import api from "../api";
import TemplateEditor from "../components/TemplateEditor";

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);

  const loadList = useCallback(() => {
    api.get("/api/templates").then(r => setTemplates(r.data)).catch(console.error);
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  async function selectTemplate(tmpl) {
    if (tmpl.isActive) {
      try {
        const res = await api.get("/api/templates/active");
        setSelected({ ...tmpl, html: res.data.html ?? "" });
      } catch (e) { console.error(e); setSelected({ ...tmpl, html: "" }); }
    } else {
      // HTML not available without a GET /:id endpoint — user can activate first
      setSelected({ ...tmpl, html: "" });
    }
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Templates</h1>
        <button onClick={createNew} disabled={creating} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium disabled:opacity-50">
          + New Template
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" style={{ minHeight: "60vh" }}>
        <div className="md:col-span-1 bg-slate-800 rounded-lg border border-slate-700 p-3 space-y-1 overflow-y-auto">
          {!templates.length && <div className="text-slate-500 text-sm text-center py-8">No templates yet</div>}
          {templates.map(t => (
            <button
              key={t._id}
              onClick={() => selectTemplate(t)}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                selected?._id === t._id ? "bg-slate-600 text-white" : "text-slate-300 hover:bg-slate-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{t.name}</span>
                {t.isActive && <span className="ml-2 shrink-0 px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">Active</span>}
              </div>
            </button>
          ))}
        </div>
        <div className="md:col-span-2 bg-slate-800 rounded-lg border border-slate-700 p-4">
          {selected && !selected.isActive && !selected.html && (
            <div className="mb-3 text-xs text-amber-400 bg-amber-900/20 rounded px-3 py-2">
              HTML editing is only available for the active template. Set this template as active to edit its HTML.
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

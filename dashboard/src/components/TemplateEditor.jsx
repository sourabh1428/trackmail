import { useState, useEffect } from "react";
import api from "../api";

export default function TemplateEditor({ template, onSaved, onActivated, onDeleted }) {
  const [html, setHtml] = useState(template?.html || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setHtml(template?.html || "");
    setError("");
  }, [template?._id]);

  async function save() {
    if (!template?._id) return;
    setSaving(true); setError("");
    try {
      await api.put(`/api/templates/${template._id}`, { html });
      onSaved?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  }

  async function activate() {
    if (!template?._id) return;
    setSaving(true); setError("");
    try {
      await api.post(`/api/templates/${template._id}/activate`);
      onActivated?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!template?._id) return;
    if (!confirm(`Delete template "${template.name}"?`)) return;
    setSaving(true); setError("");
    try {
      await api.delete(`/api/templates/${template._id}`);
      onDeleted?.();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  }

  if (!template) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        Select a template from the list
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white">{template.name}</h2>
        {template.isActive && (
          <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">Active</span>
        )}
      </div>
      {error && <div className="text-red-400 text-sm bg-red-900/20 rounded px-3 py-2">{error}</div>}
      <textarea
        value={html}
        onChange={e => setHtml(e.target.value)}
        className="min-h-48 bg-slate-900 border border-slate-600 rounded p-3 text-sm text-slate-200 font-mono resize-y focus:outline-none focus:border-blue-500"
      />
      <iframe
        srcDoc={html}
        sandbox=""
        title="Template preview"
        className="w-full h-64 rounded border border-slate-700 bg-white"
      />
      <div className="flex gap-2 flex-wrap">
        <button onClick={save} disabled={saving} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium disabled:opacity-50">Save</button>
        <button onClick={activate} disabled={saving || template.isActive} className="px-4 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm font-medium disabled:opacity-50">Set as Active</button>
        <button onClick={remove} disabled={saving || template.isActive} className="px-4 py-1.5 bg-red-700 hover:bg-red-600 rounded text-sm font-medium disabled:opacity-50">Delete</button>
      </div>
    </div>
  );
}

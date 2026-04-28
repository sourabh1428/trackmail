import { useEffect, useState } from "react";
import api from "../api";
import StatCard from "../components/StatCard";

function formatTime(value) {
  if (!value) return "No activity yet";
  const diff = Date.now() - new Date(value).getTime();
  const hours = Math.max(1, Math.round(diff / (60 * 60 * 1000)));
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function LeadList({ title, tone, rows, empty }) {
  const tones = {
    high: "border-red-500/20 bg-red-500/5 text-red-300",
    warm: "border-amber-500/20 bg-amber-500/5 text-amber-300",
    good: "border-emerald-500/20 bg-emerald-500/5 text-emerald-300",
  };

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <span className={`rounded-md border px-2 py-0.5 text-xs ${tones[tone]}`}>{rows.length}</span>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={`${title}-${row.email}`} className="rounded-md bg-slate-950/70 px-3 py-2">
            <div className="truncate text-sm font-medium text-slate-100">{row.email}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
              <span>{row.company || "Unknown company"}</span>
              <span>Stage: {row.stage}</span>
              <span>{formatTime(row.lastActivity)}</span>
            </div>
          </div>
        ))}
        {!rows.length && <div className="py-6 text-center text-sm text-slate-500">{empty}</div>}
      </div>
    </section>
  );
}

function Pipeline({ stages }) {
  const max = stages[0]?.count || 1;
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="mb-4 text-sm font-semibold text-white">Pipeline Funnel</h2>
      <div className="grid gap-3 md:grid-cols-6">
        {stages.map((stage, index) => {
          const prev = stages[index - 1]?.count;
          const conversion = prev ? Math.round((stage.count / prev) * 100) : 100;
          return (
            <div key={stage.key} className="min-w-0">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="truncate text-slate-400">{stage.label}</span>
                <span className="font-semibold text-white">{stage.count}</span>
              </div>
              <div className="h-3 overflow-hidden rounded bg-slate-800">
                <div className="h-full rounded bg-blue-500" style={{ width: `${Math.max(4, (stage.count / max) * 100)}%` }} />
              </div>
              {index > 0 && <div className="mt-1 text-xs text-slate-600">{conversion}% from previous</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WeekComparison({ digest }) {
  const rows = [
    ["Emails Sent", "sent"],
    ["Open Rate", "openRate", "%"],
    ["Replies", "replies"],
    ["Clicks", "clicks"],
  ];

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h2 className="mb-3 text-sm font-semibold text-white">This Week vs Last Week</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([label, key, suffix = ""]) => {
              const current = digest.thisWeek?.[key] ?? 0;
              const previous = digest.lastWeek?.[key] ?? 0;
              const up = current >= previous;
              return (
                <tr key={key} className="border-t border-slate-800 first:border-t-0">
                  <td className="py-2 text-slate-400">{label}</td>
                  <td className="py-2 text-right font-semibold text-white">{current}{suffix}</td>
                  <td className="py-2 text-right text-slate-500">{previous}{suffix}</td>
                  <td className={`py-2 text-right text-xs ${up ? "text-emerald-400" : "text-red-400"}`}>
                    {up ? "up" : "down"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Overview() {
  const [state, setState] = useState({ actions: null, pipeline: [], digest: null, loading: true });

  useEffect(() => {
    Promise.all([
      api.get("/api/follow-ups"),
      api.get("/api/pipeline"),
      api.get("/api/daily-digest"),
    ])
      .then(([actions, pipeline, digest]) => {
        setState({ actions: actions.data, pipeline: pipeline.data, digest: digest.data, loading: false });
      })
      .catch((error) => {
        console.error(error);
        setState((prev) => ({ ...prev, loading: false, error: error.response?.data?.error || error.message }));
      });
  }, []);

  const actions = state.actions || { followUpNow: [], hotLeads: [], newReplies: [] };
  const replied = state.pipeline.find((stage) => stage.key === "replied")?.count ?? 0;
  const opened = state.pipeline.find((stage) => stage.key === "opened")?.count ?? 0;
  const sent = state.pipeline.find((stage) => stage.key === "sent")?.count ?? 0;
  const followUps = actions.followUpNow.length;

  if (state.loading) {
    return <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-slate-400">Loading action center...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Action Center</h1>
        <p className="mt-1 text-sm text-slate-500">The next best moves across all outreach, not just one batch.</p>
      </div>

      {state.error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{state.error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Replies" value={replied} sub="most important signal" color="green" />
        <StatCard label="Follow-ups Due" value={followUps} sub="opened, no reply" color="yellow" />
        <StatCard label="Open Rate" value={sent ? `${Math.round((opened / sent) * 100)}%` : "0%"} sub={`${opened} of ${sent}`} color="blue" />
        <StatCard label="Hot Leads" value={actions.hotLeads.length} sub="repeat opens or clicks" color="purple" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <LeadList title="Follow Up Now" tone="high" rows={actions.followUpNow} empty="No follow-ups due today. You are caught up." />
        <LeadList title="Hot Leads" tone="warm" rows={actions.hotLeads} empty="No hot leads yet. Fresh engagement will show up here." />
        <LeadList title="New Replies" tone="good" rows={actions.newReplies} empty="No recent replies logged yet." />
      </div>

      <Pipeline stages={state.pipeline} />
      {state.digest && <WeekComparison digest={state.digest} />}
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import api from "../api";
import BunchSelector from "../components/BunchSelector";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const insightColors = {
  warning: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-300", dot: "bg-amber-400" },
  success: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-300", dot: "bg-emerald-400" },
  danger:  { bg: "bg-red-500/10",     border: "border-red-500/30",     text: "text-red-300",     dot: "bg-red-400"     },
  info:    { bg: "bg-blue-500/10",    border: "border-blue-500/30",    text: "text-blue-300",    dot: "bg-blue-400"    },
};

function StatCard({ label, value, sub, color = "blue" }) {
  const colors = {
    blue:   "text-blue-400",
    green:  "text-emerald-400",
    yellow: "text-amber-400",
    purple: "text-purple-400",
  };
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${colors[color]}`}>{value ?? "—"}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function FunnelBar({ label, count, max, color }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-right text-xs text-slate-500">{label}</span>
      <div className="flex-1 h-5 bg-slate-800 rounded overflow-hidden">
        <div
          className="h-full rounded transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-20 text-xs text-slate-400">
        {count} <span className="text-slate-600">({pct}%)</span>
      </span>
    </div>
  );
}

export default function Insights() {
  const [bunchId, setBunchId] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    const url = bunchId ? `/api/insights?bunchId=${encodeURIComponent(bunchId)}` : "/api/insights";
    api.get(url)
      .then((r) => setData(r.data))
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [bunchId]);

  const maxOpen = Math.max(1, ...(data?.sendTime || []).flatMap((d) => d.hours.map((h) => h.opens)));
  const funnelMax = data?.funnel?.[0]?.count || 1;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Insights</h1>
          <p className="mt-1 text-sm text-slate-500">Campaign performance, engagement signals, and smart callouts.</p>
        </div>
        <BunchSelector value={bunchId} onChange={setBunchId} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-slate-400">Loading insights…</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Sent" value={data?.stats?.sent} color="blue" />
            <StatCard label="Open Rate" value={data?.stats?.openRate != null ? `${data.stats.openRate}%` : "—"} color="green" />
            <StatCard label="Click Rate" value={data?.stats?.clickRate != null ? `${data.stats.clickRate}%` : "—"} color="yellow" />
            <StatCard label="Replies" value={data?.stats?.replies} color="purple" />
          </div>

          {data?.insights?.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-white">Smart Insights</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.insights.map((ins, i) => {
                  const c = insightColors[ins.type] || insightColors.info;
                  return (
                    <div key={i} className={`flex items-start gap-3 rounded-lg border ${c.border} ${c.bg} px-4 py-3`}>
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${c.dot}`} />
                      <p className={`text-sm ${c.text}`}>{ins.text}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-4 text-sm font-semibold text-white">Opens — Last 7 Days</h2>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data?.opensOverTime || []}>
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} width={24} />
                  <Tooltip
                    contentStyle={{ background: "#020617", border: "1px solid #1e293b", color: "#fff" }}
                    cursor={{ fill: "#1e293b" }}
                  />
                  <Bar dataKey="opens" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-4 text-sm font-semibold text-white">Engagement Funnel</h2>
              <div className="space-y-3 mt-2">
                {(data?.funnel || []).map((step) => (
                  <FunnelBar
                    key={step.label}
                    label={step.label}
                    count={step.count}
                    max={funnelMax}
                    color={step.color}
                  />
                ))}
              </div>
            </section>
          </div>

          {data?.weeklyTrends?.length > 0 && (
            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-4 text-sm font-semibold text-white">Weekly Trends</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.weeklyTrends}>
                  <XAxis dataKey="week" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} width={24} />
                  <Tooltip contentStyle={{ background: "#020617", border: "1px solid #1e293b", color: "#fff" }} />
                  <Bar dataKey="sent" fill="#3b82f6" radius={[2, 2, 0, 0]} name="Sent" />
                  <Bar dataKey="opened" fill="#22c55e" radius={[2, 2, 0, 0]} name="Opened" />
                  <Bar dataKey="replied" fill="#a855f7" radius={[2, 2, 0, 0]} name="Replied" />
                </BarChart>
              </ResponsiveContainer>
            </section>
          )}

          {data?.sendTime && (
            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-4 text-sm font-semibold text-white">Send Time Analysis</h2>
              <div className="space-y-1">
                {(data.sendTime || []).map((day) => (
                  <div key={day.day} className="grid grid-cols-[36px_1fr] items-center gap-2">
                    <span className="text-xs text-slate-500">{DAYS[day.day]}</span>
                    <div className="grid gap-0.5" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                      {day.hours.map((hour) => (
                        <div
                          key={hour.hour}
                          title={`${DAYS[day.day]} ${hour.hour}:00 — ${hour.opens} opens`}
                          className="h-4 rounded-sm bg-blue-500"
                          style={{ opacity: 0.08 + (hour.opens / maxOpen) * 0.85 }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data?.deliverability?.length > 0 && (
            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-3 text-sm font-semibold text-white">Domain Deliverability</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {data.deliverability.map((row) => (
                      <tr key={row.domain} className="border-t border-slate-800 first:border-t-0">
                        <td className="py-2 text-slate-300">{row.domain}</td>
                        <td className="py-2 text-right text-slate-500">{row.sent} sent</td>
                        <td className="py-2 text-right text-slate-300">{row.openRate}% open</td>
                        <td className="py-2 text-right">
                          {row.flagged && (
                            <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-xs text-red-300">
                              Check deliverability
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

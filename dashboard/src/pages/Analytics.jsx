import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import api from "../api";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/analytics")
      .then((r) => setData(r.data))
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-slate-400">Loading analytics...</div>;

  const maxOpen = Math.max(1, ...(data?.sendTime || []).flatMap((day) => day.hours.map((hour) => hour.opens)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">Deep-dive signals for send timing, response lag, and deliverability.</p>
      </div>

      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-4 text-sm font-semibold text-white">Weekly Trends</h2>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data?.weeklyTrends || []}>
            <XAxis dataKey="week" tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#020617", border: "1px solid #1e293b", color: "#fff" }} />
            <Line type="monotone" dataKey="sent" stroke="#60a5fa" strokeWidth={2} />
            <Line type="monotone" dataKey="opened" stroke="#22c55e" strokeWidth={2} />
            <Line type="monotone" dataKey="replied" stroke="#a855f7" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-4 text-sm font-semibold text-white">Send Time Analysis</h2>
          <div className="space-y-1">
            {(data?.sendTime || []).map((day) => (
              <div key={day.day} className="grid grid-cols-[36px_1fr] items-center gap-2">
                <span className="text-xs text-slate-500">{DAYS[day.day]}</span>
                <div className="grid gap-0.5" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                  {day.hours.map((hour) => (
                    <div
                      key={hour.hour}
                      title={`${DAYS[day.day]} ${hour.hour}:00 - ${hour.opens} opens`}
                      className="h-4 rounded-sm bg-blue-500"
                      style={{ opacity: 0.08 + (hour.opens / maxOpen) * 0.85 }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-4 text-sm font-semibold text-white">Response Lag</h2>
          <div className="space-y-2">
            {(data?.responseLag || []).slice(0, 10).map((row) => (
              <div key={row.email} className="flex items-center justify-between rounded-md bg-slate-950 px-3 py-2 text-sm">
                <span className="truncate text-slate-300">{row.email}</span>
                <span className="text-slate-500">{row.hours}h</span>
              </div>
            ))}
            {!data?.responseLag?.length && <div className="py-8 text-center text-sm text-slate-500">No open lag data yet.</div>}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-white">Domain Deliverability</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {(data?.deliverability || []).map((row) => (
                <tr key={row.domain} className="border-t border-slate-800 first:border-t-0">
                  <td className="py-2 text-slate-300">{row.domain}</td>
                  <td className="py-2 text-right text-slate-500">{row.sent} sent</td>
                  <td className="py-2 text-right text-slate-300">{row.openRate}% open</td>
                  <td className="py-2 text-right">
                    {row.flagged && <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-xs text-red-300">Check deliverability</span>}
                  </td>
                </tr>
              ))}
              {!data?.deliverability?.length && <tr><td className="py-8 text-center text-slate-500">No deliverability data yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

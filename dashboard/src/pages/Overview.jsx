import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import api from "../api";
import BunchSelector from "../components/BunchSelector";
import StatCard from "../components/StatCard";
import EventFeed from "../components/EventFeed";

export default function Overview() {
  const [bunchId, setBunchId] = useState("");
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!bunchId) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/stats?bunchId=${bunchId}`),
      api.get(`/api/events?bunchId=${bunchId}`),
    ])
      .then(([sRes, eRes]) => { setStats(sRes.data); setEvents(eRes.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [bunchId]);

  const chartData = (() => {
    const map = {};
    for (const e of events) {
      const day = e.sentAt ? new Date(e.sentAt).toLocaleDateString() : "unknown";
      if (!map[day]) map[day] = { day, opens: 0, clicks: 0 };
      if (e.opened) map[day].opens++;
      if (e.clicked) map[day].clicks++;
    }
    return Object.values(map).sort((a, b) => new Date(a.day) - new Date(b.day));
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">Overview</h1>
        <BunchSelector value={bunchId} onChange={setBunchId} />
      </div>
      {loading && <div className="text-slate-400 text-sm">Loading\u2026</div>}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Sent" value={stats.sent} color="blue" />
          <StatCard label="Opened" value={stats.opens} sub={`${stats.openRate}%`} color="green" />
          <StatCard label="Clicked" value={stats.clicks} sub={`${stats.clickRate}%`} color="yellow" />
          <StatCard label="Came Back" value={stats.cameBack} color="purple" />
        </div>
      )}
      {chartData.length > 0 && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h2 className="text-sm font-medium text-slate-400 mb-4">Opens &amp; Clicks Over Time</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", color: "#f1f5f9" }} />
              <Legend />
              <Line type="monotone" dataKey="opens" stroke="#60a5fa" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="clicks" stroke="#4ade80" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h2 className="text-sm font-medium text-slate-400 mb-3">Recent Events</h2>
        <EventFeed events={events} />
      </div>
    </div>
  );
}

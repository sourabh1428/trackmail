function relativeTime(date) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const EVENT_COLORS = {
  open: "bg-blue-500/20 text-blue-300",
  click: "bg-green-500/20 text-green-300",
  comeback: "bg-purple-500/20 text-purple-300",
};

export default function EventFeed({ events = [] }) {
  const last10 = [...events]
    .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
    .slice(0, 10);

  if (!last10.length) {
    return <div className="text-slate-500 text-sm text-center py-8">No events yet</div>;
  }

  return (
    <div className="space-y-2">
      {last10.map((e) => (
        <div key={`${e.email}-${e.event}-${e.sentAt}`} className="flex items-center gap-3 bg-slate-800 rounded px-3 py-2 text-sm">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${EVENT_COLORS[e.event] || "bg-slate-600 text-slate-300"}`}>
            {e.event}
          </span>
          <span className="text-slate-300 truncate flex-1">{e.email}</span>
          <span className="text-slate-500 text-xs shrink-0">{relativeTime(e.sentAt)}</span>
        </div>
      ))}
    </div>
  );
}

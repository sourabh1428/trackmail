const themes = {
  blue:   { card: "bg-blue-500/5 border-blue-500/20",   text: "text-blue-400",   icon: "bg-blue-500/10 text-blue-400" },
  green:  { card: "bg-green-500/5 border-green-500/20", text: "text-green-400",  icon: "bg-green-500/10 text-green-400" },
  yellow: { card: "bg-amber-500/5 border-amber-500/20", text: "text-amber-400",  icon: "bg-amber-500/10 text-amber-400" },
  purple: { card: "bg-purple-500/5 border-purple-500/20",text: "text-purple-400",icon: "bg-purple-500/10 text-purple-400" },
};

export default function StatCard({ label, value, sub, color = "blue", icon }) {
  const t = themes[color] ?? themes.blue;
  return (
    <div className={`rounded-xl p-4 border ${t.card} flex flex-col gap-3`}>
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-slate-400 leading-none">{label}</span>
        {icon && (
          <div className={`p-1.5 rounded-lg ${t.icon}`}>
            {icon}
          </div>
        )}
      </div>
      <div>
        <div className={`text-2xl font-bold leading-none ${t.text}`}>{value ?? "—"}</div>
        {sub && <div className="text-xs text-slate-500 mt-1.5">{sub}</div>}
      </div>
    </div>
  );
}

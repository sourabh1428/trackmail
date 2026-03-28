export default function StatCard({ label, value, sub, color = "blue" }) {
  const colors = {
    blue: "border-blue-500 text-blue-400",
    green: "border-green-500 text-green-400",
    yellow: "border-yellow-500 text-yellow-400",
    purple: "border-purple-500 text-purple-400",
  };
  return (
    <div className={`bg-slate-800 rounded-lg p-4 border-l-4 ${colors[color]}`}>
      <div className="text-sm text-slate-400 mb-1">{label}</div>
      <div className={`text-3xl font-bold ${colors[color].split(" ")[1]}`}>{value ?? "—"}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

import { useState, useEffect } from "react";
import api from "../api";
import BunchSelector from "../components/BunchSelector";
import RecipientTable from "../components/RecipientTable";

export default function Recipients() {
  const [bunchId, setBunchId] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!bunchId) return;
    setLoading(true);
    api.get(`/api/events?bunchId=${bunchId}`)
      .then(r => setRows(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [bunchId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">Recipients</h1>
        <BunchSelector value={bunchId} onChange={setBunchId} />
      </div>
      {loading ? <div className="text-slate-400 text-sm">Loading\u2026</div> : <RecipientTable rows={rows} />}
    </div>
  );
}

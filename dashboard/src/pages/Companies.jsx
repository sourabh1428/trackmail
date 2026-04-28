import { Fragment, useEffect, useState } from "react";
import api from "../api";

function StageBadge({ value }) {
  return <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{value || "sent"}</span>;
}

export default function Companies() {
  const [companies, setCompanies] = useState([]);
  const [expanded, setExpanded] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/companies")
      .then((r) => setCompanies(r.data))
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-slate-400">Loading companies...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Companies</h1>
        <p className="mt-1 text-sm text-slate-500">Company-level engagement, reply coverage, and deliverability risk.</p>
      </div>

      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800 bg-slate-950/80">
            <tr>
              {["Company", "People", "Open Rate", "Replies", "Best Stage", "Last Activity", "Signal"].map((heading) => (
                <th key={heading} className="px-3 py-3 text-left text-xs font-medium uppercase text-slate-500">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => (
              <Fragment key={company.company}>
                <tr onClick={() => setExpanded(expanded === company.company ? "" : company.company)} className="cursor-pointer border-b border-slate-800/70 hover:bg-slate-800/40">
                  <td className="px-3 py-3 font-medium text-slate-100">{company.company}</td>
                  <td className="px-3 py-3 text-slate-300">{company.peopleContacted}</td>
                  <td className="px-3 py-3 text-slate-300">{company.openRate}%</td>
                  <td className="px-3 py-3 text-slate-300">{company.replied}</td>
                  <td className="px-3 py-3"><StageBadge value={company.bestStage} /></td>
                  <td className="px-3 py-3 text-slate-500">{company.lastActivity ? new Date(company.lastActivity).toLocaleDateString() : "-"}</td>
                  <td className="px-3 py-3">
                    {company.spamRisk ? (
                      <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-xs text-red-300 ring-1 ring-red-500/20">Possible spam issue</span>
                    ) : (
                      <span className="text-slate-600">-</span>
                    )}
                  </td>
                </tr>
                {expanded === company.company && (
                  <tr>
                    <td colSpan={7} className="bg-slate-950/60 px-3 py-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        {company.recipients.map((row) => (
                          <div key={row.email} className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                            <div className="truncate text-sm text-slate-100">{row.email}</div>
                            <div className="mt-1 flex gap-2 text-xs text-slate-500">
                              <StageBadge value={row.stage} />
                              <span>{row.openCount || 0} opens</span>
                              <span>{row.replied ? "replied" : "no reply"}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!companies.length && (
              <tr><td colSpan={7} className="px-3 py-12 text-center text-slate-500">No company data yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

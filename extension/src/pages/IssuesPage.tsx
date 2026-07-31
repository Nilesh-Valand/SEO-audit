import { Fragment, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui";
import {
  ISSUE_CATEGORIES,
  labelCategory,
  PageShell,
  PaginationBar,
  SEVERITIES,
  SeverityBadge,
} from "../components/PageShell";
import { apiClient, type AuditIssue, type PageDetails } from "../lib/api";
import { useAuditSelection } from "../lib/AuditSelectionContext";
import { formatBackendError, shouldLinkToSettings } from "../lib/errors";

const PAGE_SIZE = 25;

export function IssuesPage() {
  const { crawlRunId, ready } = useAuditSelection();
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AuditIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    setPage(1);
    setExpandedId(null);
  }, [category, severity, crawlRunId]);

  useEffect(() => {
    if (!ready || !crawlRunId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setUnreachable(false);
      try {
        const res = await apiClient.getIssues(crawlRunId!, {
          category: category || undefined,
          severity: severity || undefined,
          page,
          page_size: PAGE_SIZE,
        });
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
      } catch (err) {
        if (cancelled) return;
        setUnreachable(shouldLinkToSettings(err));
        setError(await formatBackendError(err));
        setItems([]);
        setTotal(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [ready, crawlRunId, category, severity, page]);

  return (
    <PageShell
      title="Issues"
      subtitle={crawlRunId ? `Findings for crawl run #${crawlRunId}` : "No audit selected."}
      crawlRunId={crawlRunId}
      ready={ready}
      loading={false}
      error={error}
      unreachable={unreachable}
    >
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>
              {loading ? "Loading…" : `${total} issue${total === 1 ? "" : "s"}`}
            </CardTitle>
            <button
              type="button"
              onClick={() => {
                setCategory("");
                setSeverity("");
              }}
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              Clear filters
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-gray-700">Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="">All categories</option>
                {ISSUE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {labelCategory(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-gray-700">Severity</span>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="">All severities</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!loading && items.length === 0 && !error ? (
            <p className="px-6 py-10 text-sm text-gray-500">No issues match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-6 py-3 font-medium">Severity</th>
                    <th className="px-6 py-3 font-medium">Category</th>
                    <th className="px-6 py-3 font-medium">Rule</th>
                    <th className="px-6 py-3 font-medium">Message</th>
                    <th className="px-6 py-3 font-medium">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((issue) => {
                    const open = expandedId === issue.id;
                    return (
                      <Fragment key={issue.id}>
                        <tr
                          onClick={() => setExpandedId(open ? null : issue.id)}
                          className={`cursor-pointer border-b border-gray-50 transition-colors hover:bg-brand-50/40 ${
                            open ? "bg-brand-50/50" : ""
                          }`}
                        >
                          <td className="whitespace-nowrap px-6 py-3">
                            <SeverityBadge severity={issue.severity} />
                          </td>
                          <td className="whitespace-nowrap px-6 py-3 capitalize text-gray-700">
                            {labelCategory(issue.category)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-3 font-mono text-xs text-gray-500">
                            {issue.rule_id}
                          </td>
                          <td className="max-w-md px-6 py-3 font-medium text-gray-900">
                            {issue.message}
                          </td>
                          <td className="max-w-xs truncate px-6 py-3 text-gray-500" title={issue.target_url ?? undefined}>
                            {issue.target_url ?? "—"}
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-b border-gray-100 bg-gray-50/80">
                            <td colSpan={5} className="px-6 py-4">
                              <IssueDetails details={issue.page_details} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <PaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </CardContent>
      </Card>
    </PageShell>
  );
}

function IssueDetails({ details }: { details: PageDetails | null }) {
  if (!details) {
    return <p className="text-sm text-gray-500">No page details attached to this finding.</p>;
  }

  const vitals = details.vitals;
  const rows: { label: string; value: string }[] = [
    { label: "URL", value: details.url },
    { label: "Title", value: details.title ?? "—" },
    { label: "Meta description", value: details.meta_description ?? "—" },
    { label: "Canonical", value: details.canonical_url ?? "—" },
    { label: "Status code", value: details.status_code != null ? String(details.status_code) : "—" },
    { label: "Word count", value: details.word_count != null ? String(details.word_count) : "—" },
    {
      label: "Response time",
      value: details.response_time_ms != null ? `${Math.round(details.response_time_ms)} ms` : "—",
    },
  ];

  if (vitals) {
    rows.push(
      {
        label: "Mobile performance",
        value: vitals.mobile_performance_score != null ? String(vitals.mobile_performance_score) : "—",
      },
      {
        label: "Mobile LCP",
        value: vitals.mobile_lcp_ms != null ? `${Math.round(vitals.mobile_lcp_ms)} ms` : "—",
      },
      {
        label: "Desktop performance",
        value: vitals.desktop_performance_score != null ? String(vitals.desktop_performance_score) : "—",
      },
      {
        label: "Desktop LCP",
        value: vitals.desktop_lcp_ms != null ? `${Math.round(vitals.desktop_lcp_ms)} ms` : "—",
      },
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Page details</div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{row.label}</dt>
            <dd className="mt-1 break-words text-sm text-gray-900">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

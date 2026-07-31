import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui";
import {
  labelCategory,
  PageShell,
  scoreColor,
  SEVERITIES,
  SeverityBadge,
} from "../components/PageShell";
import { apiClient, type AuditReport } from "../lib/api";
import { useAuditSelection } from "../lib/AuditSelectionContext";
import { downloadCrawlExport, type ExportFormat } from "../lib/downloadExport";
import { formatBackendError, shouldLinkToSettings } from "../lib/errors";
import { formatDate, formatScore } from "../lib/format";

type ExportBusy = ExportFormat | null;

export function ReportPage() {
  const { crawlRunId, ready } = useAuditSelection();
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [exportBusy, setExportBusy] = useState<ExportBusy>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !crawlRunId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setUnreachable(false);
      setExportError(null);
      try {
        const res = await apiClient.getReport(crawlRunId!);
        if (cancelled) return;
        setReport(res);
      } catch (err) {
        if (cancelled) return;
        setUnreachable(shouldLinkToSettings(err));
        setError(await formatBackendError(err));
        setReport(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [ready, crawlRunId]);

  async function handleExport(format: ExportFormat) {
    if (!crawlRunId || exportBusy) return;
    setExportBusy(format);
    setExportError(null);
    try {
      await downloadCrawlExport(crawlRunId, format);
    } catch (err) {
      setExportError(await formatBackendError(err));
    } finally {
      setExportBusy(null);
    }
  }

  const categoryEntries = Object.entries(report?.category_scores ?? {}).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  const anyExportBusy = exportBusy !== null;

  return (
    <PageShell
      title="Report"
      subtitle={crawlRunId ? `Structured audit report for run #${crawlRunId}` : "No audit selected."}
      actions={
        report ? (
          <div className="print:hidden flex flex-wrap items-center gap-2">
            <ExportButton
              label="Download PDF"
              busyLabel="Generating PDF…"
              busy={exportBusy === "pdf"}
              disabled={anyExportBusy}
              onClick={() => void handleExport("pdf")}
              primary
            />
            <ExportButton
              label="Download CSV"
              busyLabel="Preparing CSV…"
              busy={exportBusy === "csv"}
              disabled={anyExportBusy}
              onClick={() => void handleExport("csv")}
            />
            <ExportButton
              label="Download Excel"
              busyLabel="Preparing Excel…"
              busy={exportBusy === "xlsx"}
              disabled={anyExportBusy}
              onClick={() => void handleExport("xlsx")}
            />
            <button
              type="button"
              onClick={() => window.print()}
              disabled={anyExportBusy}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
            >
              Print view
            </button>
          </div>
        ) : undefined
      }
      crawlRunId={crawlRunId}
      ready={ready}
      loading={loading}
      error={error}
      unreachable={unreachable}
    >
      {exportError ? (
        <div className="print:hidden rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          {exportError}
        </div>
      ) : null}

      {report ? (
        <div className="report-print space-y-8">
          <Card>
            <CardContent className="space-y-6 py-8">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-gray-100 pb-6">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                    SEO Audit Report
                  </div>
                  <h2 className="mt-1 text-3xl font-bold text-gray-900">
                    {report.project.domain ?? "Unknown domain"}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Crawl date: {formatDate(report.crawl_date)} · Run #{crawlRunId}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide text-gray-500">Overall score</div>
                  <div
                    className="mt-1 text-5xl font-bold tabular-nums"
                    style={{ color: scoreColor(report.overall_score) }}
                  >
                    {formatScore(report.overall_score)}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <SummaryStat label="Pages audited" value={String(report.summary.total_pages)} />
                <SummaryStat label="Total issues" value={String(report.summary.total_issues)} />
                <SummaryStat
                  label="Critical + high"
                  value={String(
                    (report.summary.issues_by_severity.critical ?? 0) +
                      (report.summary.issues_by_severity.high ?? 0),
                  )}
                />
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                  Issues by severity
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {SEVERITIES.map((key) => (
                    <div key={key} className="rounded-lg border border-gray-200 px-4 py-3">
                      <div className="text-xs font-medium uppercase text-gray-500">{key}</div>
                      <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900">
                        {report.summary.issues_by_severity[key] ?? 0}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <section className="break-inside-avoid">
            <h2 className="mb-4 text-xl font-bold text-gray-900">Category breakdown</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {categoryEntries.map(([category, score]) => (
                <Card key={category}>
                  <CardContent className="py-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold capitalize text-gray-900">
                        {labelCategory(category)}
                      </div>
                      <div
                        className="text-2xl font-bold tabular-nums"
                        style={{ color: scoreColor(score) }}
                      >
                        {formatScore(score)}
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(0, Math.min(100, score))}%`,
                          backgroundColor: scoreColor(score),
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section className="break-inside-avoid">
            <h2 className="mb-4 text-xl font-bold text-gray-900">Prioritized recommendations</h2>
            {report.recommendations.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-sm text-gray-500">
                  No prioritized recommendations for this run.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <ol className="divide-y divide-gray-100">
                    {report.recommendations.map((rec, index) => (
                      <li key={`${rec.rule}-${index}`} className="px-6 py-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
                            {index + 1}
                          </span>
                          <SeverityBadge severity={rec.severity} />
                          <span className="text-xs capitalize text-gray-500">
                            {labelCategory(rec.category)}
                          </span>
                          <span className="text-xs text-gray-400">{rec.pages_affected} pages</span>
                          <span className="font-mono text-xs text-gray-400">{rec.rule}</span>
                        </div>
                        <p className="mt-2 text-sm font-medium leading-relaxed text-gray-900">
                          {rec.message}
                        </p>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-xl font-bold text-gray-900">Findings by category</h2>
            <div className="space-y-6">
              {report.categories.map((cat) => (
                <Card key={cat.name} className="break-inside-avoid">
                  <CardHeader className="flex flex-row items-center justify-between gap-3">
                    <CardTitle className="capitalize">{labelCategory(cat.name)}</CardTitle>
                    <span
                      className="text-lg font-bold tabular-nums"
                      style={{ color: scoreColor(cat.score) }}
                    >
                      {formatScore(cat.score)}
                    </span>
                  </CardHeader>
                  <CardContent className="p-0">
                    {cat.issues.length === 0 ? (
                      <p className="px-6 py-5 text-sm text-gray-500">No issues in this category.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead className="border-y border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                              <th className="px-6 py-3 font-medium">Severity</th>
                              <th className="px-6 py-3 font-medium">Rule</th>
                              <th className="px-6 py-3 font-medium">URL</th>
                              <th className="px-6 py-3 font-medium">Message</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cat.issues.map((issue, idx) => (
                              <tr key={`${cat.name}-${idx}`} className="border-b border-gray-50">
                                <td className="whitespace-nowrap px-6 py-3">
                                  <SeverityBadge severity={issue.severity} />
                                </td>
                                <td className="whitespace-nowrap px-6 py-3 font-mono text-xs text-gray-500">
                                  {issue.rule}
                                </td>
                                <td
                                  className="max-w-xs truncate px-6 py-3 text-gray-600"
                                  title={issue.url ?? undefined}
                                >
                                  {issue.url ?? "—"}
                                </td>
                                <td className="max-w-lg px-6 py-3 text-gray-900">{issue.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </PageShell>
  );
}

function ExportButton({
  label,
  busyLabel,
  busy,
  disabled,
  onClick,
  primary = false,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  const base =
    "rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60";
  const tone = primary
    ? "bg-brand-600 text-white hover:bg-brand-700"
    : "border border-gray-300 bg-white text-gray-800 hover:bg-gray-50";

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${tone}`}>
      {busy ? (
        <span className="inline-flex items-center gap-2">
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80"
            aria-hidden
          />
          {busyLabel}
        </span>
      ) : (
        label
      )}
    </button>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums text-gray-900">{value}</div>
    </div>
  );
}

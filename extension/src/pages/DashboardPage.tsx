import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui";
import {
  labelCategory,
  PageShell,
  RunContextLinks,
  scoreColor,
  SEVERITIES,
} from "../components/PageShell";
import {
  apiClient,
  type CrawlRunSummary,
  type Project,
  type ScoreHistoryItem,
} from "../lib/api";
import { useAuditSelection } from "../lib/AuditSelectionContext";
import { formatBackendError, shouldLinkToSettings } from "../lib/errors";
import { formatDate, formatScore, StatusPill } from "../lib/format";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#d97706",
  low: "#0284c7",
};

const HISTORY_LINE_COLORS = [
  "#0f172a",
  "#0284c7",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#db2777",
  "#0d9488",
  "#ea580c",
  "#4f46e5",
  "#64748b",
];

export function DashboardPage() {
  const { projectId, crawlRunId, ready } = useAuditSelection();
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [summary, setSummary] = useState<CrawlRunSummary | null>(null);
  const [scoreHistory, setScoreHistory] = useState<ScoreHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    if (!ready || !crawlRunId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setUnreachable(false);
      try {
        const [run, sum] = await Promise.all([
          apiClient.getCrawlRun(crawlRunId!),
          apiClient.getSummary(crawlRunId!),
        ]);
        if (cancelled) return;
        setStatus(run.status);
        setSummary(sum);

        const resolvedProjectId = projectId ?? run.project_id;
        const [projects, history] = await Promise.all([
          apiClient.listProjects({ page: 1, page_size: 200 }),
          apiClient.getScoreHistory(resolvedProjectId),
        ]);
        if (cancelled) return;
        setProject(projects.items.find((p) => p.id === resolvedProjectId) ?? null);
        setScoreHistory(history.items);
      } catch (err) {
        if (cancelled) return;
        setUnreachable(shouldLinkToSettings(err));
        setError(await formatBackendError(err));
        setSummary(null);
        setScoreHistory([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [ready, crawlRunId, projectId]);

  const overall = summary?.overall_score ?? null;
  const gaugeData = useMemo(
    () => [{ name: "score", value: Math.max(0, Math.min(100, overall ?? 0)), fill: scoreColor(overall) }],
    [overall],
  );

  const categoryData = useMemo(
    () =>
      Object.entries(summary?.category_scores ?? {})
        .map(([category, score]) => ({
          category,
          label: labelCategory(category),
          score: Math.round(score),
          fill: scoreColor(score),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [summary],
  );

  const severityData = useMemo(
    () =>
      SEVERITIES.map((key) => ({
        severity: key,
        count: summary?.total_issues_by_severity?.[key] ?? 0,
        fill: SEVERITY_COLORS[key],
      })),
    [summary],
  );

  const historyCategories = useMemo(() => {
    const keys = new Set<string>();
    for (const item of scoreHistory) {
      for (const category of Object.keys(item.category_scores)) {
        keys.add(category);
      }
    }
    return Array.from(keys).sort((a, b) => labelCategory(a).localeCompare(labelCategory(b)));
  }, [scoreHistory]);

  const historyChartData = useMemo(
    () =>
      scoreHistory.map((item) => {
        const row: Record<string, string | number | null> = {
          label: item.date ? formatDate(item.date) : `Run #${item.crawl_run_id}`,
          runId: item.crawl_run_id,
          overall: item.overall_score,
        };
        for (const category of historyCategories) {
          row[category] = item.category_scores[category] ?? null;
        }
        return row;
      }),
    [scoreHistory, historyCategories],
  );

  const totalIssues = severityData.reduce((acc, row) => acc + row.count, 0);

  return (
    <PageShell
      title="Dashboard"
      subtitle={
        crawlRunId
          ? `${project?.domain ?? `Project #${projectId}`} · Run #${crawlRunId}`
          : "No audit selected."
      }
      actions={
        crawlRunId ? (
          <>
            {status ? <StatusPill status={status} /> : null}
            <RunContextLinks projectId={projectId} />
          </>
        ) : undefined
      }
      crawlRunId={crawlRunId}
      ready={ready}
      loading={loading}
      error={error}
      unreachable={unreachable}
    >
      {summary ? (
        <>
          <div className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle>Overall score</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative mx-auto h-56 w-full max-w-xs">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadialBarChart
                      cx="50%"
                      cy="50%"
                      innerRadius="72%"
                      outerRadius="100%"
                      data={gaugeData}
                      startAngle={90}
                      endAngle={-270}
                    >
                      <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                      <RadialBar background dataKey="value" cornerRadius={12} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-5xl font-bold tabular-nums text-gray-900">
                      {formatScore(overall)}
                    </div>
                    <div className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                      / 100
                    </div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3 text-center text-sm">
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Pages</div>
                    <div className="mt-0.5 text-xl font-bold text-gray-900">{summary.total_pages}</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Issues</div>
                    <div className="mt-0.5 text-xl font-bold text-gray-900">{totalIssues}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-8">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Issues by severity</CardTitle>
                <Link to="/issues" className="text-sm font-semibold text-brand-700 hover:underline">
                  View all →
                </Link>
              </CardHeader>
              <CardContent>
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {severityData.map((row) => (
                    <div key={row.severity} className="rounded-lg border border-gray-100 px-4 py-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        {row.severity}
                      </div>
                      <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: row.fill }}>
                        {row.count}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={severityData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <XAxis dataKey="severity" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={36} />
                      <Tooltip
                        formatter={(value) => [value ?? 0, "Issues"]}
                        contentStyle={{ borderRadius: 8, borderColor: "#e5e7eb" }}
                      />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                        {severityData.map((row) => (
                          <Cell key={row.severity} fill={row.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Category scores</h2>
            </div>
            {categoryData.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-sm text-gray-500">No category scores yet.</CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {categoryData.map((row) => (
                  <Card key={row.category}>
                    <CardContent className="flex items-center gap-4 py-5">
                      <div
                        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-xl font-bold text-white"
                        style={{ backgroundColor: row.fill }}
                      >
                        {row.score}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold capitalize text-gray-900">
                          {row.label}
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${row.score}%`, backgroundColor: row.fill }}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {categoryData.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Category comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={categoryData}
                      layout="vertical"
                      margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                    >
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={120}
                        tick={{ fontSize: 12 }}
                        className="capitalize"
                      />
                      <Tooltip
                        formatter={(value) => [value ?? 0, "Score"]}
                        contentStyle={{ borderRadius: 8, borderColor: "#e5e7eb" }}
                      />
                      <Bar dataKey="score" radius={[0, 6, 6, 0]} barSize={18}>
                        {categoryData.map((row) => (
                          <Cell key={row.category} fill={row.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Score over time</CardTitle>
            </CardHeader>
            <CardContent>
              {historyChartData.length < 2 ? (
                <p className="py-6 text-sm text-gray-500">
                  {historyChartData.length === 1
                    ? "Only one scored audit so far. Run another crawl to see trends."
                    : "No scored audits yet for this project."}
                </p>
              ) : (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historyChartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} width={36} />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, borderColor: "#e5e7eb" }}
                        formatter={(value, name) => [
                          value == null ? "—" : Math.round(Number(value)),
                          name === "overall" ? "Overall" : labelCategory(String(name)),
                        ]}
                      />
                      <Legend
                        formatter={(value) =>
                          value === "overall" ? "Overall" : labelCategory(String(value))
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="overall"
                        stroke={HISTORY_LINE_COLORS[0]}
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                      {historyCategories.map((category, index) => (
                        <Line
                          key={category}
                          type="monotone"
                          dataKey={category}
                          stroke={HISTORY_LINE_COLORS[(index + 1) % HISTORY_LINE_COLORS.length]}
                          strokeWidth={1.75}
                          dot={{ r: 2 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {!loading && !summary && !error && crawlRunId ? (
        <Card>
          <CardContent className="py-8 text-sm text-gray-600">
            Summary is not available yet for this run{status ? ` (status: ${status})` : ""}.
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  );
}

import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreGauge } from "@/components/charts/ScoreGauge";
import { SeverityChart } from "@/components/charts/SeverityChart";
import { ExportDropdown } from "@/components/ExportDropdown";
import { ApiError } from "@/components/ApiError";
import { DeleteButton } from "@/components/DeleteButton";
import { StatusPill } from "@/components/StatusPill";
import { apiClient } from "@/lib/api";
import { formatDate, formatScore } from "@/lib/format";

const categoryCards = [
  { key: "technical", label: "Technical" },
  { key: "on_page", label: "On-Page" },
  { key: "performance", label: "Performance" },
  { key: "mobile", label: "Mobile" },
  { key: "security", label: "Security" },
  { key: "structured_data", label: "Structured Data" },
  { key: "content", label: "Content" },
];

export default async function ProjectDashboardPage({
  params,
}: {
  params: { projectId: string };
}) {
  const projectId = Number(params.projectId);

  let projects;
  let crawlRuns;
  try {
    [projects, crawlRuns] = await Promise.all([
      apiClient.listProjects({ page: 1, page_size: 200 }),
      apiClient.listCrawlRuns({ project_id: projectId, page: 1, page_size: 50 }),
    ]);
  } catch (error) {
    return (
      <div className="p-8">
        <ApiError message={error instanceof Error ? error.message : "Failed to load dashboard."} />
      </div>
    );
  }

  const project = projects.items.find((item) => item.id === projectId);
  const latestRun = crawlRuns.items[0] ?? null;

  let summary = null;
  if (latestRun) {
    try {
      summary = await apiClient.getSummary(latestRun.id);
    } catch {
      summary = null;
    }
  }

  const severityData = [
    { severity: "critical", count: summary?.total_issues_by_severity.critical ?? 0 },
    { severity: "high", count: summary?.total_issues_by_severity.high ?? 0 },
    { severity: "medium", count: summary?.total_issues_by_severity.medium ?? 0 },
    { severity: "low", count: summary?.total_issues_by_severity.low ?? 0 },
  ];

  return (
    <div className="space-y-8 p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Link href="/dashboard" className="text-sm font-medium text-brand-600 hover:underline">
            ← All projects
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">{project?.domain ?? "Project Dashboard"}</h1>
          <p className="mt-1 text-sm text-gray-500">
            Latest crawl overview, issue breakdown, and all runs for this project.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {latestRun ? <ExportDropdown crawlRunId={latestRun.id} /> : null}
          <ButtonLink href="/audits/new">Run New Audit</ButtonLink>
          {project ? (
            <DeleteButton
              target={{ type: "project", id: project.id, label: project.domain }}
              redirectTo="/dashboard"
            />
          ) : null}
        </div>
      </div>

      {!latestRun ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            No crawl runs found for this project yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Latest Run #{latestRun.id}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <StatusPill status={latestRun.status} />
                  <span className="text-xs text-gray-500">{formatDate(latestRun.finished_at ?? latestRun.started_at)}</span>
                </div>
                <ScoreGauge score={summary?.overall_score ?? null} />
                <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                  <div>
                    Pages crawled:{" "}
                    <span className="font-medium text-gray-900">
                      {summary?.total_pages ?? latestRun.total_pages}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {categoryCards.map((card) => (
                <Card key={card.key}>
                  <CardContent className="py-6">
                    <div className="text-sm text-gray-500">{card.label}</div>
                    <div className="mt-2 text-3xl font-bold text-gray-900">
                      {formatScore(summary?.category_scores[card.key])}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <Card>
              <CardHeader>
                <CardTitle>Issue Severity Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <SeverityChart data={severityData} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Links</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ButtonLink href={`/audits/${latestRun.id}/issues`} className="w-full">
                  View Issues
                </ButtonLink>
                <ButtonLink href={`/audits/${latestRun.id}/pages`} className="w-full bg-gray-900 hover:bg-gray-800">
                  Browse Pages
                </ButtonLink>
                <ButtonLink href={`/audits/${latestRun.id}/report`} className="w-full bg-white text-gray-900 border border-gray-300 hover:bg-gray-50">
                  View Report
                </ButtonLink>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All runs for this project</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {crawlRuns.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">No runs yet.</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-3 pr-4">Run</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Pages</th>
                  <th className="py-3 pr-4">Started</th>
                  <th className="py-3 pr-4">Finished</th>
                  <th className="py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {crawlRuns.items.map((run) => (
                  <tr key={run.id}>
                    <td className="py-3 pr-4 font-medium text-gray-900">#{run.id}</td>
                    <td className="py-3 pr-4">
                      <StatusPill status={run.status} />
                    </td>
                    <td className="py-3 pr-4 text-gray-700">{run.total_pages}</td>
                    <td className="py-3 pr-4 text-gray-600">{formatDate(run.started_at)}</td>
                    <td className="py-3 pr-4 text-gray-600">{formatDate(run.finished_at)}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link href={`/audits/${run.id}/report`} className="font-medium text-brand-600 hover:underline">
                          Report
                        </Link>
                        <Link href={`/audits/${run.id}/issues`} className="font-medium text-brand-600 hover:underline">
                          Issues
                        </Link>
                        <Link href={`/audits/${run.id}/pages`} className="font-medium text-brand-600 hover:underline">
                          Pages
                        </Link>
                        <DeleteButton
                          target={{ type: "crawl_run", id: run.id, label: `audit run #${run.id}` }}
                          className="px-2 py-1"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

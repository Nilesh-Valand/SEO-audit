import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreGauge } from "@/components/charts/ScoreGauge";
import { SeverityChart } from "@/components/charts/SeverityChart";
import { ExportDropdown } from "@/components/ExportDropdown";
import { ApiError } from "@/components/ApiError";
import { apiClient } from "@/lib/api";

const categoryCards = [
  { key: "technical", label: "Technical" },
  { key: "on_page", label: "On-Page" },
  { key: "performance", label: "Performance" },
  { key: "mobile", label: "Mobile" },
  { key: "security", label: "Security" },
  { key: "structured_data", label: "Structured Data" },
  { key: "content", label: "Content" },
];

function displayScore(score: number | undefined) {
  return score !== undefined ? Math.round(score) : "--";
}

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
      apiClient.listCrawlRuns({ project_id: projectId, page: 1, page_size: 10 }),
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
          <h1 className="text-3xl font-bold text-gray-900">{project?.domain ?? "Project Dashboard"}</h1>
          <p className="mt-1 text-sm text-gray-500">
            Latest crawl overview, issues, and category scores.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {latestRun ? <ExportDropdown crawlRunId={latestRun.id} /> : null}
          <ButtonLink href="/audits/new">Run New Audit</ButtonLink>
        </div>
      </div>

      {!latestRun || !summary ? (
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
                <CardTitle>Latest Run</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ScoreGauge score={summary.overall_score} />
                <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                  <div>Status: <span className="font-medium text-gray-900">{latestRun.status}</span></div>
                  <div className="mt-2">Pages crawled: <span className="font-medium text-gray-900">{summary.total_pages}</span></div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {categoryCards.map((card) => (
                <Card key={card.key}>
                  <CardContent className="py-6">
                    <div className="text-sm text-gray-500">{card.label}</div>
                    <div className="mt-2 text-3xl font-bold text-gray-900">
                      {displayScore(summary.category_scores[card.key])}
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
    </div>
  );
}

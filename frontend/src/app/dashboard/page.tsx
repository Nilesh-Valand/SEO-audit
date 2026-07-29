import Link from "next/link";
import { ApiError } from "@/components/ApiError";
import { DeleteButton } from "@/components/DeleteButton";
import { StatusPill } from "@/components/StatusPill";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient, CrawlRun, CrawlRunSummary, Project } from "@/lib/api";
import { formatDate, formatScore } from "@/lib/format";

type ProjectCard = {
  project: Project;
  latestRun: CrawlRun | null;
  summary: CrawlRunSummary | null;
  runCount: number;
};

export default async function DashboardPage() {
  let projects: Project[] = [];
  let crawlRuns: CrawlRun[] = [];

  try {
    const [projectResponse, crawlResponse] = await Promise.all([
      apiClient.listProjects({ page: 1, page_size: 100 }),
      apiClient.listCrawlRuns({ page: 1, page_size: 200 }),
    ]);
    projects = projectResponse.items;
    crawlRuns = crawlResponse.items;
  } catch (error) {
    return (
      <div className="p-8">
        <ApiError message={error instanceof Error ? error.message : "Failed to load dashboard."} />
      </div>
    );
  }

  const runsByProject = new Map<number, CrawlRun[]>();
  for (const run of crawlRuns) {
    const existing = runsByProject.get(run.project_id) ?? [];
    existing.push(run);
    runsByProject.set(run.project_id, existing);
  }

  const cards: ProjectCard[] = await Promise.all(
    projects.map(async (project) => {
      const projectRuns = runsByProject.get(project.id) ?? [];
      const latestRun = projectRuns[0] ?? null;
      let summary: CrawlRunSummary | null = null;
      if (latestRun && latestRun.status === "completed") {
        try {
          summary = await apiClient.getSummary(latestRun.id);
        } catch {
          summary = null;
        }
      }
      return {
        project,
        latestRun,
        summary,
        runCount: projectRuns.length,
      };
    }),
  );

  const completedCount = crawlRuns.filter((run) => run.status === "completed").length;
  const runningCount = crawlRuns.filter((run) =>
    ["running", "pending", "enriching"].includes(run.status),
  ).length;

  return (
    <div className="space-y-8 p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            All projects and their latest audit runs in one place.
          </p>
        </div>
        <ButtonLink href="/audits/new">Run New Audit</ButtonLink>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-gray-500">Projects</div>
            <div className="mt-1 text-3xl font-bold text-gray-900">{projects.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-gray-500">Completed audits</div>
            <div className="mt-1 text-3xl font-bold text-gray-900">{completedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-gray-500">In progress</div>
            <div className="mt-1 text-3xl font-bold text-gray-900">{runningCount}</div>
          </CardContent>
        </Card>
      </div>

      {cards.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-lg font-semibold text-gray-900">No audits yet</p>
            <p className="mt-2 text-sm text-gray-500">
              Start your first crawl to see project scores and findings here.
            </p>
            <div className="mt-6">
              <ButtonLink href="/audits/new">Create first audit</ButtonLink>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cards.map(({ project, latestRun, summary, runCount }) => (
            <Card key={project.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="break-all">{project.domain}</CardTitle>
                  <p className="mt-1 text-xs text-gray-500">
                    Created {formatDate(project.created_at)} · {runCount} run{runCount === 1 ? "" : "s"}
                  </p>
                </div>
                {latestRun ? <StatusPill status={latestRun.status} /> : null}
              </CardHeader>
              <CardContent className="space-y-4">
                {latestRun ? (
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <div className="text-gray-500">Score</div>
                      <div className="mt-1 text-xl font-semibold text-gray-900">
                        {formatScore(summary?.overall_score)}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">Pages</div>
                      <div className="mt-1 text-xl font-semibold text-gray-900">
                        {summary?.total_pages ?? latestRun.total_pages}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500">Issues</div>
                      <div className="mt-1 text-xl font-semibold text-gray-900">
                        {summary
                          ? Object.values(summary.total_issues_by_severity).reduce((a, b) => a + b, 0)
                          : "—"}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No crawl runs for this project yet.</p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/dashboard/${project.id}`}
                    className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    Open project
                  </Link>
                  {latestRun ? (
                    <>
                      <Link
                        href={`/audits/${latestRun.id}/report`}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                      >
                        Report
                      </Link>
                      <Link
                        href={`/audits/${latestRun.id}/issues`}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                      >
                        Issues
                      </Link>
                    </>
                  ) : null}
                  <DeleteButton
                    target={{ type: "project", id: project.id, label: project.domain }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

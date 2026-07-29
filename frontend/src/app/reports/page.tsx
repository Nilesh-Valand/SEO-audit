import Link from "next/link";
import { ApiError } from "@/components/ApiError";
import { DeleteButton } from "@/components/DeleteButton";
import { StatusPill } from "@/components/StatusPill";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient, CrawlRun, Project } from "@/lib/api";
import { formatDate, formatScore } from "@/lib/format";

type ReportRow = {
  run: CrawlRun;
  project: Project | undefined;
  overallScore: number | null;
  totalIssues: number | null;
};

export default async function ReportsPage() {
  let projects: Project[] = [];
  let crawlRuns: CrawlRun[] = [];

  try {
    const [projectResponse, crawlResponse] = await Promise.all([
      apiClient.listProjects({ page: 1, page_size: 200 }),
      apiClient.listCrawlRuns({ page: 1, page_size: 200 }),
    ]);
    projects = projectResponse.items;
    crawlRuns = crawlResponse.items;
  } catch (error) {
    return (
      <div className="p-8">
        <ApiError message={error instanceof Error ? error.message : "Failed to load reports."} />
      </div>
    );
  }

  const projectMap = new Map(projects.map((project) => [project.id, project]));

  const rows: ReportRow[] = await Promise.all(
    crawlRuns.map(async (run) => {
      let overallScore: number | null = null;
      let totalIssues: number | null = null;
      if (run.status === "completed") {
        try {
          const summary = await apiClient.getSummary(run.id);
          overallScore = summary.overall_score;
          totalIssues = Object.values(summary.total_issues_by_severity).reduce((a, b) => a + b, 0);
        } catch {
          overallScore = null;
          totalIssues = null;
        }
      }
      return {
        run,
        project: projectMap.get(run.project_id),
        overallScore,
        totalIssues,
      };
    }),
  );

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="mt-1 text-sm text-gray-500">
            Every audit run across all projects, with links to detailed reports.
          </p>
        </div>
        <ButtonLink href="/audits/new">Run New Audit</ButtonLink>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All audit runs ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rows.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-lg font-semibold text-gray-900">No reports yet</p>
              <p className="mt-2 text-sm text-gray-500">
                Completed audits will appear here with scores and export links.
              </p>
              <div className="mt-6">
                <ButtonLink href="/audits/new">Start an audit</ButtonLink>
              </div>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-3 pr-4">Project</th>
                  <th className="py-3 pr-4">Run</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Score</th>
                  <th className="py-3 pr-4">Pages</th>
                  <th className="py-3 pr-4">Issues</th>
                  <th className="py-3 pr-4">Finished</th>
                  <th className="py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(({ run, project, overallScore, totalIssues }) => (
                  <tr key={run.id} className="align-middle">
                    <td className="py-4 pr-4">
                      <div className="font-medium text-gray-900 break-all">
                        {project?.domain ?? `Project #${run.project_id}`}
                      </div>
                    </td>
                    <td className="py-4 pr-4 text-gray-700">#{run.id}</td>
                    <td className="py-4 pr-4">
                      <StatusPill status={run.status} />
                    </td>
                    <td className="py-4 pr-4 font-semibold text-gray-900">
                      {formatScore(overallScore)}
                    </td>
                    <td className="py-4 pr-4 text-gray-700">{run.total_pages}</td>
                    <td className="py-4 pr-4 text-gray-700">{totalIssues ?? "—"}</td>
                    <td className="py-4 pr-4 text-gray-600">{formatDate(run.finished_at)}</td>
                    <td className="py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          href={`/audits/${run.id}/report`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          Report
                        </Link>
                        <Link
                          href={`/audits/${run.id}/issues`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          Issues
                        </Link>
                        <Link
                          href={`/audits/${run.id}/pages`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          Pages
                        </Link>
                        <Link
                          href={`/dashboard/${run.project_id}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          Project
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

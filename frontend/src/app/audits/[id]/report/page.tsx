import { ExportDropdown } from "@/components/ExportDropdown";
import { ScoreGauge } from "@/components/charts/ScoreGauge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/components/ApiError";
import { apiClient, getApiUrl } from "@/lib/api";

export default async function AuditReportPage({
  params,
}: {
  params: { id: string };
}) {
  const auditId = Number(params.id);

  let report;
  try {
    report = await apiClient.getReport(auditId);
  } catch (error) {
    return (
      <div className="space-y-6 p-8">
        <ApiError message={error instanceof Error ? error.message : "Failed to load report."} />
      </div>
    );
  }

  return (
    <div className="space-y-8 bg-white p-8 print:p-0">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{report.project.domain ?? "Audit Report"}</h1>
          <p className="mt-1 text-sm text-gray-500">Printable and shareable audit summary.</p>
        </div>
        <div className="flex items-center gap-3">
          <ExportDropdown crawlRunId={auditId} />
          <a
            href={getApiUrl(`/api/crawl-runs/${auditId}/export/pdf`)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Download PDF
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Overall Score</CardTitle>
          </CardHeader>
          <CardContent>
            <ScoreGauge score={report.overall_score} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg bg-gray-50 p-4">
              <div className="text-sm text-gray-500">Total Pages</div>
              <div className="mt-2 text-3xl font-bold text-gray-900">{report.summary.total_pages}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-4">
              <div className="text-sm text-gray-500">Total Issues</div>
              <div className="mt-2 text-3xl font-bold text-gray-900">{report.summary.total_issues}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          {report.recommendations.length === 0 ? (
            <p className="text-sm text-gray-500">No recommendations yet. Run an audit to generate findings.</p>
          ) : (
            <ul className="space-y-3 text-sm text-gray-700">
              {report.recommendations.map((item) => (
                <li key={`${item.rule}-${item.category}`} className="rounded-lg border border-gray-200 p-4">
                  <div className="font-semibold text-gray-900">
                    {item.rule} ({item.severity})
                  </div>
                  <div className="mt-1">{item.message}</div>
                  <div className="mt-2 text-xs text-gray-500">Affects {item.pages_affected} pages</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {report.categories.map((category) => (
        <Card key={category.name}>
          <CardHeader>
            <CardTitle>
              {category.name} {category.score !== null ? `· ${Math.round(category.score)}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-3 pr-4">URL</th>
                  <th className="py-3 pr-4">Rule</th>
                  <th className="py-3 pr-4">Severity</th>
                  <th className="py-3">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {category.issues.map((issue, index) => (
                  <tr key={`${category.name}-${index}`}>
                    <td className="py-4 pr-4 text-gray-900">{issue.url ?? "--"}</td>
                    <td className="py-4 pr-4">{issue.rule}</td>
                    <td className="py-4 pr-4 capitalize">{issue.severity}</td>
                    <td className="py-4 text-gray-600">{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

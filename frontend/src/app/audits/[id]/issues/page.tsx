import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/components/ApiError";
import { AuditBackNav } from "@/components/AuditBackNav";
import { apiClient } from "@/lib/api";

export default async function AuditIssuesPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { category?: string; severity?: string; page?: string };
}) {
  const auditId = Number(params.id);
  const page = Number(searchParams.page ?? "1");

  let issues;
  let projectId: number | null = null;
  try {
    const [issuesResponse, crawlRun] = await Promise.all([
      apiClient.getIssues(auditId, {
        category: searchParams.category,
        severity: searchParams.severity,
        page,
        page_size: 25,
      }),
      apiClient.getCrawlRun(auditId),
    ]);
    issues = issuesResponse;
    projectId = crawlRun.project_id;
  } catch (error) {
    return (
      <div className="space-y-6 p-8">
        <ApiError message={error instanceof Error ? error.message : "Failed to load issues."} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-8">
      <div>
        <AuditBackNav auditId={auditId} projectId={projectId} active="issues" />
        <h1 className="text-3xl font-bold text-gray-900">Audit Issues</h1>
        <p className="mt-1 text-sm text-gray-500">Review, filter, and inspect all findings for this audit.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-3" method="get">
            <Select name="category" defaultValue={searchParams.category ?? ""}>
              <option value="">All categories</option>
              <option value="technical">Technical</option>
              <option value="performance">Performance</option>
              <option value="content">Content</option>
              <option value="security">Security</option>
              <option value="structured_data">Structured Data</option>
              <option value="indexing">Indexing</option>
            </Select>
            <Select name="severity" defaultValue={searchParams.severity ?? ""}>
              <option value="">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
            <button className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white">
              Apply Filters
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Findings</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {issues.items.length === 0 ? (
            <p className="py-8 text-center text-gray-500">
              No issues found. Run an audit first from the dashboard.
            </p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-3 pr-4">URL</th>
                  <th className="py-3 pr-4">Category</th>
                  <th className="py-3 pr-4">Severity</th>
                  <th className="py-3 pr-4">Message</th>
                  <th className="py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {issues.items.map((issue) => (
                  <tr key={issue.id} className="align-top">
                    <td className="py-4 pr-4 text-gray-900">{issue.target_url ?? "--"}</td>
                    <td className="py-4 pr-4 capitalize">{issue.category.replaceAll("_", " ")}</td>
                    <td className="py-4 pr-4"><Badge value={issue.severity} /></td>
                    <td className="py-4 pr-4 text-gray-600">{issue.message}</td>
                    <td className="py-4">
                      {issue.page_details ? (
                        <details className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <summary className="cursor-pointer font-medium text-brand-600">Expand</summary>
                          <div className="mt-3 space-y-2 text-sm text-gray-600">
                            <div><span className="font-medium text-gray-900">Title:</span> {issue.page_details.title ?? "--"}</div>
                            <div><span className="font-medium text-gray-900">Meta:</span> {issue.page_details.meta_description ?? "--"}</div>
                            <div><span className="font-medium text-gray-900">Canonical:</span> {issue.page_details.canonical_url ?? "--"}</div>
                            <div><span className="font-medium text-gray-900">Word Count:</span> {issue.page_details.word_count ?? "--"}</div>
                            <div><span className="font-medium text-gray-900">CWV:</span> LCP {issue.page_details.vitals?.mobile_lcp_ms ?? "--"} ms, INP {issue.page_details.vitals?.mobile_inp_ms ?? "--"} ms, CLS {issue.page_details.vitals?.mobile_cls ?? "--"}</div>
                          </div>
                        </details>
                      ) : (
                        <span className="text-gray-400">Run-level finding</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <div>Total issues: {issues.total}</div>
        <div className="flex gap-4">
          {page > 1 ? <a href={`?category=${searchParams.category ?? ""}&severity=${searchParams.severity ?? ""}&page=${page - 1}`} className="text-brand-600 hover:underline">Previous</a> : <span className="text-gray-300">Previous</span>}
          {issues.page * issues.page_size < issues.total ? <a href={`?category=${searchParams.category ?? ""}&severity=${searchParams.severity ?? ""}&page=${page + 1}`} className="text-brand-600 hover:underline">Next</a> : <span className="text-gray-300">Next</span>}
        </div>
      </div>
    </div>
  );
}

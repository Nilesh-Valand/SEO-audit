import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/components/ApiError";
import { AuditBackNav } from "@/components/AuditBackNav";
import { apiClient } from "@/lib/api";

export default async function AuditPagesPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    search?: string;
    sort_by?: string;
    sort_order?: string;
    status_code?: string;
    issue_category?: string;
    page?: string;
  };
}) {
  const auditId = Number(params.id);
  const page = Number(searchParams.page ?? "1");

  let pages;
  let projectId: number | null = null;
  try {
    const [pagesResponse, crawlRun] = await Promise.all([
      apiClient.getPages(auditId, {
        search: searchParams.search,
        sort_by: searchParams.sort_by ?? "url",
        sort_order: searchParams.sort_order ?? "asc",
        status_code: searchParams.status_code ? Number(searchParams.status_code) : undefined,
        issue_category: searchParams.issue_category,
        page,
        page_size: 50,
      }),
      apiClient.getCrawlRun(auditId),
    ]);
    pages = pagesResponse;
    projectId = crawlRun.project_id;
  } catch (error) {
    return (
      <div className="space-y-6 p-8">
        <ApiError message={error instanceof Error ? error.message : "Failed to load pages."} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-8">
      <div>
        <AuditBackNav auditId={auditId} projectId={projectId} active="pages" />
        <h1 className="text-3xl font-bold text-gray-900">Crawled Pages</h1>
        <p className="mt-1 text-sm text-gray-500">Search and sort through every page discovered in this audit.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-5" method="get">
            <Input name="search" placeholder="Search URL..." defaultValue={searchParams.search ?? ""} />
            <Select name="sort_by" defaultValue={searchParams.sort_by ?? "url"}>
              <option value="url">Sort by URL</option>
              <option value="status_code">Sort by status code</option>
              <option value="word_count">Sort by word count</option>
              <option value="response_time_ms">Sort by load time</option>
            </Select>
            <Select name="sort_order" defaultValue={searchParams.sort_order ?? "asc"}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </Select>
            <Input name="status_code" placeholder="Status code" defaultValue={searchParams.status_code ?? ""} />
            <button className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white">
              Apply
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pages</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-3 pr-4">URL</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Word Count</th>
                <th className="py-3 pr-4">Load Time (ms)</th>
                <th className="py-3">Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pages.items.map((pageItem) => (
                <tr key={pageItem.id}>
                  <td className="py-4 pr-4 text-gray-900">
                    <div className="font-medium">{pageItem.url}</div>
                    <div className="text-xs text-gray-500">{pageItem.title ?? "Untitled page"}</div>
                  </td>
                  <td className="py-4 pr-4">{pageItem.status_code ?? "--"}</td>
                  <td className="py-4 pr-4">{pageItem.word_count ?? "--"}</td>
                  <td className="py-4 pr-4">{pageItem.response_time_ms ? Math.round(pageItem.response_time_ms) : "--"}</td>
                  <td className="py-4">{pageItem.issue_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <div>Total pages: {pages.total}</div>
        <div className="flex gap-4">
          {page > 1 ? <a href={`?search=${searchParams.search ?? ""}&sort_by=${searchParams.sort_by ?? "url"}&sort_order=${searchParams.sort_order ?? "asc"}&status_code=${searchParams.status_code ?? ""}&page=${page - 1}`} className="text-brand-600 hover:underline">Previous</a> : <span className="text-gray-300">Previous</span>}
          {pages.page * pages.page_size < pages.total ? <a href={`?search=${searchParams.search ?? ""}&sort_by=${searchParams.sort_by ?? "url"}&sort_order=${searchParams.sort_order ?? "asc"}&status_code=${searchParams.status_code ?? ""}&page=${page + 1}`} className="text-brand-600 hover:underline">Next</a> : <span className="text-gray-300">Next</span>}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui";
import { PageShell, PaginationBar } from "../components/PageShell";
import { apiClient, type CrawledPage } from "../lib/api";
import { useAuditSelection } from "../lib/AuditSelectionContext";
import { formatBackendError, shouldLinkToSettings } from "../lib/errors";

const PAGE_SIZE = 50;

type SortBy = "url" | "status_code" | "word_count" | "response_time_ms";
type SortOrder = "asc" | "desc";

export function PagesPage() {
  const { crawlRunId, ready } = useAuditSelection();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("url");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CrawledPage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, sortBy, sortOrder, crawlRunId]);

  useEffect(() => {
    if (!ready || !crawlRunId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setUnreachable(false);
      try {
        const statusCode = statusFilter ? Number(statusFilter) : undefined;
        const res = await apiClient.getPages(crawlRunId!, {
          search: search || undefined,
          status_code: Number.isFinite(statusCode) ? statusCode : undefined,
          sort_by: sortBy,
          sort_order: sortOrder,
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
  }, [ready, crawlRunId, search, statusFilter, sortBy, sortOrder, page]);

  const columns = useMemo(
    () =>
      [
        { key: "url" as const, label: "URL / Title" },
        { key: "status_code" as const, label: "Status" },
        { key: "word_count" as const, label: "Words" },
        { key: "response_time_ms" as const, label: "Response" },
      ] as const,
    [],
  );

  function toggleSort(key: SortBy) {
    if (sortBy === key) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortOrder(key === "url" ? "asc" : "desc");
    }
  }

  return (
    <PageShell
      title="Pages"
      subtitle={crawlRunId ? `Crawled pages for run #${crawlRunId}` : "No audit selected."}
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
              {loading ? "Loading…" : `${total} page${total === 1 ? "" : "s"}`}
            </CardTitle>
          </div>
          <div className="grid gap-3 lg:grid-cols-12">
            <label className="space-y-1.5 text-sm lg:col-span-7">
              <span className="font-medium text-gray-700">Search URL</span>
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Filter by URL substring…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <label className="space-y-1.5 text-sm lg:col-span-3">
              <span className="font-medium text-gray-700">Status code</span>
              <input
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="e.g. 200"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <div className="flex items-end lg:col-span-2">
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                  setStatusFilter("");
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
              >
                Reset
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!loading && items.length === 0 && !error ? (
            <p className="px-6 py-10 text-sm text-gray-500">No pages match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    {columns.map((col) => {
                      const active = sortBy === col.key;
                      return (
                        <th key={col.key} className="px-6 py-3 font-medium">
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={`inline-flex items-center gap-1 hover:text-gray-800 ${
                              active ? "text-brand-700" : ""
                            }`}
                          >
                            {col.label}
                            <span className="tabular-nums text-[10px]">
                              {active ? (sortOrder === "asc" ? "▲" : "▼") : "↕"}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                    <th className="px-6 py-3 font-medium">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((pageRow) => (
                    <tr key={pageRow.id} className="border-b border-gray-50 hover:bg-gray-50/80">
                      <td className="max-w-xl px-6 py-3">
                        <div className="truncate font-medium text-gray-900" title={pageRow.title ?? undefined}>
                          {pageRow.title || "Untitled"}
                        </div>
                        <div className="truncate text-xs text-gray-500" title={pageRow.url}>
                          {pageRow.url}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3">
                        <StatusCode code={pageRow.status_code} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 tabular-nums text-gray-700">
                        {pageRow.word_count ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 tabular-nums text-gray-700">
                        {pageRow.response_time_ms != null
                          ? `${Math.round(pageRow.response_time_ms)} ms`
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 tabular-nums text-gray-700">
                        {pageRow.issue_count}
                      </td>
                    </tr>
                  ))}
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

function StatusCode({ code }: { code: number | null }) {
  if (code == null) return <span className="text-gray-400">—</span>;
  const tone =
    code >= 200 && code < 300
      ? "bg-emerald-100 text-emerald-800"
      : code >= 300 && code < 400
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${tone}`}>
      {code}
    </span>
  );
}

import { Link } from "react-router-dom";
import { BackendUnreachable } from "./BackendUnreachable";
import { NoAuditSelected } from "./NoAuditSelected";
import { ReactNode } from "react";

export function PageShell({
  title,
  subtitle,
  actions,
  crawlRunId,
  ready,
  loading,
  error,
  unreachable,
  children,
  wide = true,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  crawlRunId: number | null;
  ready: boolean;
  loading?: boolean;
  error: string | null;
  unreachable: boolean;
  children?: ReactNode;
  wide?: boolean;
}) {
  if (!ready) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  return (
    <div className={`space-y-6 ${wide ? "mx-auto max-w-7xl" : "mx-auto max-w-3xl"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">{title}</h1>
          {subtitle ? <div className="mt-1 text-sm text-gray-500">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {!crawlRunId ? <NoAuditSelected /> : null}
      {unreachable && error ? <BackendUnreachable message={error} /> : null}
      {!unreachable && error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          <p>{error}</p>
          {/settings/i.test(error) ? (
            <Link to="/settings" className="mt-3 inline-block font-semibold text-brand-700 hover:underline">
              Open Settings →
            </Link>
          ) : null}
        </div>
      ) : null}
      {loading ? <p className="text-sm text-gray-500">Loading…</p> : null}
      {crawlRunId && !unreachable ? children : null}
    </div>
  );
}

export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-6 py-3 text-sm text-gray-600">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium hover:bg-gray-50 disabled:opacity-40"
        >
          Previous
        </button>
        <span className="tabular-nums text-gray-500">
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium hover:bg-gray-50 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const key = severity.toLowerCase();
  const className =
    key === "critical"
      ? "bg-red-100 text-red-800"
      : key === "high"
        ? "bg-orange-100 text-orange-800"
        : key === "medium"
          ? "bg-amber-100 text-amber-800"
          : "bg-sky-100 text-sky-800";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${className}`}>
      {severity}
    </span>
  );
}

export function scoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return "#94a3b8";
  if (score >= 80) return "#059669";
  if (score >= 60) return "#0284c7";
  if (score >= 40) return "#d97706";
  return "#dc2626";
}

export function labelCategory(category: string): string {
  if (category === "ai_readiness") return "AI Readiness";
  return category.replace(/_/g, " ");
}

export const ISSUE_CATEGORIES = [
  "technical",
  "on_page",
  "content",
  "performance",
  "structured_data",
  "security",
  "indexing",
  "crawlability",
  "ai_readiness",
] as const;

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

export function RunContextLinks({ projectId }: { projectId: number | null }) {
  return (
    <>
      <Link
        to="/issues"
        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
      >
        Issues
      </Link>
      <Link
        to="/pages"
        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
      >
        Pages
      </Link>
      <Link
        to="/report"
        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
      >
        Report
      </Link>
      {projectId ? (
        <Link
          to={`/projects/${projectId}`}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
        >
          History
        </Link>
      ) : null}
    </>
  );
}

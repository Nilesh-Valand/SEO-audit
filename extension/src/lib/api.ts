import { getApiBaseUrl } from "./storage";
import { ApiError, parseApiErrorBody } from "./errors";

const DEFAULT_TIMEOUT_MS = 12_000;

export type PaginatedResponse<T> = {
  total: number;
  page: number;
  page_size: number;
  items: T[];
};

export type Project = {
  id: number;
  domain: string;
  created_at: string;
};

export type CrawlRun = {
  id: number;
  project_id: number;
  status: string;
  total_pages: number;
  started_at: string | null;
  finished_at: string | null;
};

export type CrawlRunProgress = {
  id: number;
  project_id: number;
  status: string;
  pages_crawled: number;
  started_at: string | null;
  finished_at: string | null;
  active: boolean;
};

export type CrawlRunSummary = {
  overall_score: number | null;
  category_scores: Record<string, number>;
  total_pages: number;
  total_issues_by_severity: Record<string, number>;
};

export type ScoreItem = {
  category: string;
  score: number;
};

export type PageVitals = {
  mobile_performance_score: number | null;
  mobile_lcp_ms: number | null;
  mobile_inp_ms: number | null;
  mobile_cls: number | null;
  desktop_performance_score: number | null;
  desktop_lcp_ms: number | null;
  desktop_inp_ms: number | null;
  desktop_cls: number | null;
};

export type PageDetails = {
  id: number;
  url: string;
  title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  word_count: number | null;
  status_code: number | null;
  response_time_ms: number | null;
  vitals: PageVitals | null;
};

export type AuditIssue = {
  id: number;
  rule_id: string;
  category: string;
  severity: string;
  target_url: string | null;
  message: string;
  page_details: PageDetails | null;
};

export type CrawledPage = {
  id: number;
  url: string;
  title: string | null;
  status_code: number | null;
  word_count: number | null;
  response_time_ms: number | null;
  issue_count: number;
};

export type AuditReport = {
  project: { id: number; domain: string | null };
  crawl_date: string | null;
  overall_score: number | null;
  category_scores: Record<string, number>;
  summary: {
    total_pages: number;
    total_issues: number;
    issues_by_severity: Record<string, number>;
  };
  categories: {
    name: string;
    score: number | null;
    issues: {
      url: string | null;
      rule: string;
      severity: string;
      message: string;
    }[];
  }[];
  recommendations: {
    rule: string;
    severity: string;
    category: string;
    message: string;
    pages_affected: number;
  }[];
};

export type ScoreHistoryItem = {
  crawl_run_id: number;
  date: string | null;
  overall_score: number | null;
  category_scores: Record<string, number>;
};

export type DiffIssue = {
  rule_id: string;
  category: string;
  severity: string;
  target_url: string | null;
  message: string;
};

export type CrawlRunDiff = {
  current_run_id: number;
  compare_to_run_id: number;
  new_issues: DiffIssue[];
  resolved_issues: DiffIssue[];
  persisting_issues: DiffIssue[];
  counts: {
    new: number;
    resolved: number;
    persisting: number;
  };
};

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  timeoutMs?: number;
};

async function buildUrl(path: string, query?: RequestOptions["query"]) {
  const base = await getApiBaseUrl();
  const url = new URL(`${base}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(await buildUrl(path, query), {
      ...rest,
      signal: rest.signal ?? controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(rest.headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new ApiError(res.status, parseApiErrorBody(res.status, errorText));
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    if (!text) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(res.status, "Backend returned invalid JSON.");
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s (${path})`);
    }
    if (
      error instanceof TypeError ||
      (error instanceof Error && /failed to fetch|networkerror|fetch failed/i.test(error.message))
    ) {
      throw new Error(`Failed to fetch ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  delete: <T = void>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "DELETE" }),
};

export const apiClient = {
  health: () => api.get<{ status: string }>("/api/health"),
  listProjects: (query?: { page?: number; page_size?: number }) =>
    api.get<PaginatedResponse<Project>>("/api/projects", { query }),
  createProject: (domain: string) => api.post<Project>("/api/projects", { domain }),
  deleteProject: (id: number) => api.delete(`/api/projects/${id}`),
  listCrawlRuns: (query?: { project_id?: number; page?: number; page_size?: number }) =>
    api.get<PaginatedResponse<CrawlRun>>("/api/crawl-runs", { query }),
  createCrawlRun: (payload: {
    project_id: number;
    start_url: string;
    max_pages: number;
    max_depth?: number;
    enable_pagespeed?: boolean | null;
  }) =>
    api.post<{ crawl_run_id: number; status: string }>("/api/crawl-runs", payload, {
      timeoutMs: 30_000,
    }),
  deleteCrawlRun: (id: number) => api.delete(`/api/crawl-runs/${id}`),
  getCrawlRun: (id: number) =>
    api.get<CrawlRunProgress>(`/api/crawl-runs/${id}`, { timeoutMs: 30_000 }),
  runAudit: (id: number) =>
    api.post<{ crawl_run_id: number; issues_created: number; scores_created: number }>(
      `/api/crawl-runs/${id}/run-audit`,
      undefined,
      { timeoutMs: 120_000 },
    ),
  getSummary: (id: number) =>
    api.get<CrawlRunSummary>(`/api/crawl-runs/${id}/summary`, { timeoutMs: 30_000 }),
  getReport: (id: number) =>
    api.get<AuditReport>(`/api/crawl-runs/${id}/report`, { timeoutMs: 60_000 }),
  getScores: (id: number) => api.get<{ items: ScoreItem[] }>(`/api/crawl-runs/${id}/scores`),
  getScoreHistory: (projectId: number) =>
    api.get<{ items: ScoreHistoryItem[] }>(`/api/projects/${projectId}/score-history`),
  getCrawlRunDiff: (id: number, compareTo: number) =>
    api.get<CrawlRunDiff>(`/api/crawl-runs/${id}/diff`, { query: { compare_to: compareTo } }),
  getIssues: (
    id: number,
    query?: { category?: string; severity?: string; page?: number; page_size?: number },
  ) => api.get<PaginatedResponse<AuditIssue>>(`/api/crawl-runs/${id}/issues`, { query }),
  getPages: (
    id: number,
    query?: {
      status_code?: number;
      issue_category?: string;
      search?: string;
      sort_by?: string;
      sort_order?: string;
      page?: number;
      page_size?: number;
    },
  ) => api.get<PaginatedResponse<CrawledPage>>(`/api/crawl-runs/${id}/pages`, { query }),
};

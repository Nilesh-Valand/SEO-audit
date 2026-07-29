const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
};

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

export type ReportCategory = {
  name: string;
  score: number | null;
  issues: {
    url: string | null;
    rule: string;
    severity: string;
    message: string;
  }[];
};

export type ReportRecommendation = {
  rule: string;
  severity: string;
  category: string;
  message: string;
  pages_affected: number;
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
  categories: ReportCategory[];
  recommendations: ReportRecommendation[];
};

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const url = new URL(`${API_BASE}${path}`);
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
  const { body, query, ...rest } = options;
  const res = await fetch(buildUrl(path, query), {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(rest.headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: rest.cache ?? "no-store",
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API error ${res.status}: ${errorText}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
};

export function getApiUrl(path: string) {
  return `${API_BASE}${path}`;
}

export const apiClient = {
  listProjects: (query?: { page?: number; page_size?: number }) =>
    api.get<PaginatedResponse<Project>>("/api/projects", { query }),
  createProject: (domain: string) =>
    api.post<Project>("/api/projects", { domain }),
  listCrawlRuns: (query?: { project_id?: number; page?: number; page_size?: number }) =>
    api.get<PaginatedResponse<CrawlRun>>("/api/crawl-runs", { query }),
  createCrawlRun: (payload: {
    project_id: number;
    start_url: string;
    max_pages: number;
    max_depth?: number;
    enable_pagespeed?: boolean;
  }) => api.post<{ crawl_run_id: number; status: string }>("/api/crawl-runs", payload),
  getCrawlRun: (id: number) =>
    api.get<CrawlRunProgress>(`/api/crawl-runs/${id}`),
  runAudit: (id: number) =>
    api.post<{ crawl_run_id: number; issues_created: number; scores_created: number }>(
      `/api/crawl-runs/${id}/run-audit`,
    ),
  getSummary: (id: number) =>
    api.get<CrawlRunSummary>(`/api/crawl-runs/${id}/summary`),
  getReport: (id: number) =>
    api.get<AuditReport>(`/api/crawl-runs/${id}/report`),
  getScores: (id: number) =>
    api.get<{ items: ScoreItem[] }>(`/api/crawl-runs/${id}/scores`),
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

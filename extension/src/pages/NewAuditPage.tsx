import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BackendUnreachable } from "../components/BackendUnreachable";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui";
import { apiClient, type Project } from "../lib/api";
import { useAuditSelection } from "../lib/AuditSelectionContext";
import { formatBackendError, shouldLinkToSettings } from "../lib/errors";
import { normalizeUrl, ProgressBar, StatusPill } from "../lib/format";

const POLL_MS = 2500;
const MAX_POLL_FAILURES = 5;

function domainFromUrl(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

async function findOrCreateProject(startUrl: string): Promise<Project> {
  const domain = domainFromUrl(startUrl);
  const existing = await apiClient.listProjects({ page: 1, page_size: 200 });
  const match = existing.items.find((p) => p.domain.toLowerCase() === domain);
  if (match) return match;
  return apiClient.createProject(domain);
}

export function NewAuditPage() {
  const navigate = useNavigate();
  const { selectAudit } = useAuditSelection();

  const [startUrl, setStartUrl] = useState("");
  const [maxPages, setMaxPages] = useState(50);
  const [enablePagespeed, setEnablePagespeed] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  const [crawlRunId, setCrawlRunId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pagesCrawled, setPagesCrawled] = useState(0);
  const [activeMaxPages, setActiveMaxPages] = useState(50);

  const pollRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const pollFailuresRef = useRef(0);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
      }
    };
  }, []);

  function stopPolling() {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
  }

  async function pollOnce(runId: number, projId: number) {
    const progress = await apiClient.getCrawlRun(runId);
    if (cancelledRef.current) return;

    pollFailuresRef.current = 0;
    setUnreachable(false);
    setError(null);
    setStatus(progress.status);
    setPagesCrawled(progress.pages_crawled);

    const done =
      !progress.active &&
      (progress.status === "completed" || progress.status === "failed");

    if (!done) return;

    stopPolling();

    if (progress.status === "failed") {
      setError(
        "Crawl failed. Check the backend terminal for the error, restart uvicorn with `--reload-dir app`, then try again.",
      );
      setSubmitting(false);
      return;
    }

    try {
      const summary = await apiClient.getSummary(runId);
      if (summary.overall_score == null) {
        await apiClient.runAudit(runId);
      }
    } catch {
      // Dashboard can still load; scores may be generated on demand later.
    }

    await selectAudit(projId, runId);
    navigate("/");
  }

  function startPolling(runId: number, projId: number) {
    setPolling(true);
    pollFailuresRef.current = 0;
    setUnreachable(false);
    setError(null);

    const handlePollError = async (err: unknown) => {
      if (cancelledRef.current) return;
      pollFailuresRef.current += 1;
      // Transient blips (reload, brief busy period) should not abort a live crawl.
      if (pollFailuresRef.current < MAX_POLL_FAILURES) {
        return;
      }
      stopPolling();
      setSubmitting(false);
      setUnreachable(shouldLinkToSettings(err));
      setError(await formatBackendError(err));
    };

    void pollOnce(runId, projId).catch((err) => {
      void handlePollError(err);
    });

    pollRef.current = window.setInterval(() => {
      void pollOnce(runId, projId).catch((err) => {
        void handlePollError(err);
      });
    }, POLL_MS);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setUnreachable(false);
    stopPolling();

    const url = normalizeUrl(startUrl);
    if (!url) {
      setError("Enter a domain or start URL.");
      return;
    }

    try {
      const parsed = new URL(url);
      if (!parsed.hostname) {
        setError("Enter a valid URL (e.g. https://example.com).");
        return;
      }
    } catch {
      setError("Enter a valid URL (e.g. https://example.com).");
      return;
    }

    const max = Math.max(1, Math.min(5000, Math.floor(maxPages) || 1));
    setActiveMaxPages(max);
    setSubmitting(true);
    setPagesCrawled(0);
    setStatus("pending");

    try {
      const project = await findOrCreateProject(url);
      const created = await apiClient.createCrawlRun({
        project_id: project.id,
        start_url: url,
        max_pages: max,
        enable_pagespeed: enablePagespeed,
      });

      setCrawlRunId(created.crawl_run_id);
      startPolling(created.crawl_run_id, project.id);
    } catch (err) {
      setSubmitting(false);
      setUnreachable(shouldLinkToSettings(err));
      setError(await formatBackendError(err));
    }
  }

  const progressPct =
    activeMaxPages > 0 ? Math.min(100, (pagesCrawled / activeMaxPages) * 100) : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 lg:text-[1.75rem]">New Audit</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
          Start a crawl against a domain. Progress updates while the backend runs.
        </p>
      </div>

      {unreachable && error ? <BackendUnreachable message={error} /> : null}
      {!unreachable && error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Crawl settings</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700" htmlFor="start-url">
                Domain / start URL
              </label>
              <input
                id="start-url"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                placeholder="https://example.com"
                disabled={submitting || polling}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700" htmlFor="max-pages">
                Max pages
              </label>
              <input
                id="max-pages"
                type="number"
                min={1}
                max={5000}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
                disabled={submitting || polling}
              />
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-gray-200 px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                checked={enablePagespeed}
                onChange={(e) => setEnablePagespeed(e.target.checked)}
                disabled={submitting || polling}
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">
                  PageSpeed enrichment
                </span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  Off by default. Requires a PageSpeed API key on the backend when enabled.
                </span>
              </span>
            </label>

            <button
              type="submit"
              disabled={submitting || polling}
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
            >
              {polling ? "Crawling…" : submitting ? "Starting…" : "Start audit"}
            </button>
          </form>
        </CardContent>
      </Card>

      {(polling || crawlRunId !== null) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Crawl progress</CardTitle>
              {status ? <StatusPill status={status} /> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProgressBar
              value={progressPct}
              label={`${pagesCrawled} / ${activeMaxPages} pages crawled`}
            />
            <p className="text-xs text-gray-500">
              Crawl in progress
              {status === "enriching" ? " · Running sitemap checks & scoring…" : ""}
              {status === "completed" ? " · Complete — opening dashboard…" : ""}
            </p>
            {!polling && status === "failed" ? (
              <p className="text-sm text-red-700">
                This crawl failed. You can start a new one or check{" "}
                <Link to="/projects" className="font-semibold text-brand-700 hover:underline">
                  Projects
                </Link>
                .
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

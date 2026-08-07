import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BackendUnreachable } from "../components/BackendUnreachable";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui";
import { apiClient, type CrawlRunProgress, type Project } from "../lib/api";
import { useAuditSelection } from "../lib/AuditSelectionContext";
import {
  formatBackendError,
  isTimeoutError,
  shouldLinkToSettings,
} from "../lib/errors";
import { normalizeUrl, ProgressBar, StatusPill } from "../lib/format";

const POLL_MS = 3000;
/** Soft poll failures (timeouts while job is still running) before we warn. */
const MAX_SOFT_FAILURES = 8;
/** Hard failures (backend down) before we stop — ~2+ minutes with backoff. */
const MAX_HARD_FAILURES = 5;
const FATAL_FAILURE_WINDOW_MS = 120_000;

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

function progressCopy(progress: CrawlRunProgress | null, pagesCrawled: number, maxPages: number): string {
  if (!progress) return "Starting…";
  if (progress.status === "failed") {
    return progress.error_message || "Crawl failed.";
  }
  if (progress.status === "completed") {
    return "Complete — opening dashboard…";
  }
  const label = progress.phase_label;
  const cur = progress.phase_current;
  const tot = progress.phase_total;
  if (label && cur != null && tot != null && tot > 0) {
    return `${label}: ${cur} / ${tot}`;
  }
  if (label) return `${label}…`;
  if (progress.status === "enriching" || pagesCrawled >= maxPages) {
    return "Running checks & scoring…";
  }
  return "Crawl in progress";
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
  const [latestProgress, setLatestProgress] = useState<CrawlRunProgress | null>(null);

  const pollRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const inFlightRef = useRef(false);
  const softFailuresRef = useRef(0);
  const hardFailuresRef = useRef(0);
  const firstFailureAtRef = useRef<number | null>(null);

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
    inFlightRef.current = false;
  }

  function resetFailureCounters() {
    softFailuresRef.current = 0;
    hardFailuresRef.current = 0;
    firstFailureAtRef.current = null;
  }

  async function pollOnce(runId: number, projId: number) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const progress = await apiClient.getCrawlRun(runId);
      if (cancelledRef.current) return;

      resetFailureCounters();
      setUnreachable(false);
      setError(null);
      setLatestProgress(progress);
      setStatus(progress.status);
      setPagesCrawled(progress.pages_crawled);

      const done =
        !progress.active &&
        (progress.status === "completed" || progress.status === "failed");

      if (!done) return;

      stopPolling();

      if (progress.status === "failed") {
        setError(
          progress.error_message ||
            "Crawl failed. Check the backend terminal for the error, then try again.",
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
    } finally {
      inFlightRef.current = false;
    }
  }

  function startPolling(runId: number, projId: number) {
    setPolling(true);
    resetFailureCounters();
    setUnreachable(false);
    setError(null);

    const handlePollError = async (err: unknown) => {
      if (cancelledRef.current) return;

      const now = Date.now();
      if (firstFailureAtRef.current == null) {
        firstFailureAtRef.current = now;
      }

      const timedOut = isTimeoutError(err);
      // Timeouts while a job is running are expected during PageSpeed — stay quiet.
      if (timedOut) {
        softFailuresRef.current += 1;
        if (softFailuresRef.current < MAX_SOFT_FAILURES) {
          return;
        }
      } else {
        hardFailuresRef.current += 1;
        if (hardFailuresRef.current < MAX_HARD_FAILURES) {
          return;
        }
      }

      const elapsed = now - (firstFailureAtRef.current ?? now);
      if (elapsed < FATAL_FAILURE_WINDOW_MS && hardFailuresRef.current < MAX_HARD_FAILURES) {
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
    setLatestProgress(null);

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

  const phaseCur = latestProgress?.phase_current;
  const phaseTot = latestProgress?.phase_total;
  const showPhaseBar =
    latestProgress?.phase != null &&
    latestProgress.phase !== "crawling" &&
    phaseCur != null &&
    phaseTot != null &&
    phaseTot > 0;

  const crawlPct =
    activeMaxPages > 0 ? Math.min(100, (pagesCrawled / activeMaxPages) * 100) : 0;
  const phasePct =
    showPhaseBar && phaseTot ? Math.min(100, (phaseCur / phaseTot) * 100) : 0;

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
                  On large crawls this step can take several minutes.
                </span>
              </span>
            </label>

            <button
              type="submit"
              disabled={submitting || polling}
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
            >
              {polling ? "Auditing…" : submitting ? "Starting…" : "Start audit"}
            </button>
          </form>
        </CardContent>
      </Card>

      {(polling || crawlRunId !== null) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Audit progress</CardTitle>
              {status ? <StatusPill status={status} /> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProgressBar
              value={crawlPct}
              label={`${pagesCrawled} / ${activeMaxPages} pages crawled`}
            />
            {showPhaseBar ? (
              <ProgressBar
                value={phasePct}
                label={progressCopy(latestProgress, pagesCrawled, activeMaxPages)}
              />
            ) : (
              <p className="text-xs text-gray-500">
                {progressCopy(latestProgress, pagesCrawled, activeMaxPages)}
              </p>
            )}
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

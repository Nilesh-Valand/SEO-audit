"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient, CrawlRunProgress } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export default function NewAuditPage() {
  const [domain, setDomain] = useState("");
  const [maxPages, setMaxPages] = useState(200);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CrawlRunProgress | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<number | null>(null);
  const [createdRunId, setCreatedRunId] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);

  const completionPercent = useMemo(() => {
    if (!progress) return 0;
    return Math.min(100, Math.round((progress.pages_crawled / Math.max(maxPages, 1)) * 100));
  }, [progress, maxPages]);

  useEffect(() => {
    const maxPagesRaw = window.localStorage.getItem("seo_audit_default_max_pages");
    if (maxPagesRaw) {
      const parsed = Number(maxPagesRaw);
      if (!Number.isNaN(parsed) && parsed > 0) setMaxPages(parsed);
    }

    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
      }
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setProgress(null);

    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }

    try {
      const startUrl = normalizeUrl(domain);
      if (!startUrl) {
        setError("Please enter a domain or URL.");
        return;
      }

      const project = await apiClient.createProject(startUrl);
      setCreatedProjectId(project.id);

      const crawlRun = await apiClient.createCrawlRun({
        project_id: project.id,
        start_url: startUrl,
        max_pages: maxPages,
      });
      setCreatedRunId(crawlRun.crawl_run_id);
      setProgress({
        id: crawlRun.crawl_run_id,
        project_id: project.id,
        status: crawlRun.status,
        pages_crawled: 0,
        started_at: null,
        finished_at: null,
        active: true,
      });

      pollRef.current = window.setInterval(async () => {
        try {
          const nextProgress = await apiClient.getCrawlRun(crawlRun.crawl_run_id);
          setProgress(nextProgress);
          if (!nextProgress.active || nextProgress.status === "completed" || nextProgress.status === "failed") {
            if (pollRef.current !== null) {
              window.clearInterval(pollRef.current);
              pollRef.current = null;
            }
            if (nextProgress.status === "failed") {
              setError("Crawl failed. Try again with a smaller max-pages value or a different URL.");
            }
          }
        } catch (err) {
          if (pollRef.current !== null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setError(err instanceof Error ? err.message : "Failed to poll crawl progress.");
        }
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start audit.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Run New Audit</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create a project, kick off a crawl, and monitor progress in real time.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Audit Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Domain URL</label>
              <Input
                placeholder="https://example.com"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Max Pages</label>
              <Input
                type="number"
                min={1}
                max={5000}
                value={maxPages}
                onChange={(event) => setMaxPages(Number(event.target.value))}
              />
              <p className="text-xs text-gray-500">
                Large sites (like Shopify) have huge sitemaps. Raise max pages if you need broader coverage.
              </p>
            </div>

            {error ? <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

            <Button type="submit" disabled={submitting || !domain.trim()}>
              {submitting ? "Starting Audit..." : "Start Audit"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {progress ? (
        <Card>
          <CardHeader>
            <CardTitle>Crawl Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress
              value={completionPercent}
              label={`${progress.pages_crawled} / ${maxPages} pages crawled`}
            />
            <div className="text-sm text-gray-600">
              Status: <span className="font-medium text-gray-900">{progress.status}</span>
            </div>
            {progress.status === "completed" ? (
              <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
                Crawl completed successfully. Open the dashboard or report to review findings.
              </div>
            ) : null}
            {createdRunId ? (
              <div className="flex flex-wrap gap-3">
                <a className="text-sm font-medium text-brand-600 hover:underline" href="/dashboard">
                  All projects
                </a>
                <a className="text-sm font-medium text-brand-600 hover:underline" href="/reports">
                  All reports
                </a>
                <a className="text-sm font-medium text-brand-600 hover:underline" href={`/audits/${createdRunId}/report`}>
                  View report
                </a>
                <a className="text-sm font-medium text-brand-600 hover:underline" href={`/audits/${createdRunId}/issues`}>
                  View issues
                </a>
                <a className="text-sm font-medium text-brand-600 hover:underline" href={`/audits/${createdRunId}/pages`}>
                  View pages
                </a>
                {createdProjectId ? (
                  <a className="text-sm font-medium text-brand-600 hover:underline" href={`/dashboard/${createdProjectId}`}>
                    Open project
                  </a>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

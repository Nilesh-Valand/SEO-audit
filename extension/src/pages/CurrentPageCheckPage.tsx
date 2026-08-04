import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui";
import { analyzeActiveTab } from "../lib/analyzeActiveTab";
import type { PageExtractResult, PageRuleResult, RuleSeverity } from "../lib/pageCheckTypes";
import { evaluatePageRules } from "../lib/pageRules";

const severityClass: Record<RuleSeverity, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-sky-100 text-sky-800 border-sky-200",
};

export function CurrentPageCheckPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tabTitle, setTabTitle] = useState<string | null>(null);
  const [data, setData] = useState<PageExtractResult | null>(null);
  const [rules, setRules] = useState<PageRuleResult[] | null>(null);

  const summary = useMemo(() => {
    if (!rules) return null;
    const failed = rules.filter((r) => !r.passed);
    return {
      total: rules.length,
      passed: rules.length - failed.length,
      failed: failed.length,
    };
  }, [rules]);

  async function handleAnalyze() {
    setLoading(true);
    setError(null);
    try {
      const { tab, data: extracted } = await analyzeActiveTab();
      setTabTitle(tab.title ?? extracted.title ?? extracted.url);
      setData(extracted);
      setRules(evaluatePageRules(extracted));
    } catch (err) {
      setData(null);
      setRules(null);
      setTabTitle(null);
      setError(err instanceof Error ? err.message : "Failed to analyze the active tab.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 lg:text-[1.75rem]">
            Current Page Check
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            Inspect SEO signals on the active browser tab — no backend required.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleAnalyze()}
            disabled={loading}
            className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? "Analyzing…" : "Analyze active tab"}
          </button>
          <Link
            to="/audits/new"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Run full site audit instead
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {summary && data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="py-5">
                <div className="text-sm text-gray-500">Checks</div>
                <div className="mt-1 text-3xl font-bold text-gray-900">{summary.total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-5">
                <div className="text-sm text-gray-500">Passed</div>
                <div className="mt-1 text-3xl font-bold text-emerald-700">{summary.passed}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-5">
                <div className="text-sm text-gray-500">Failed</div>
                <div className="mt-1 text-3xl font-bold text-red-700">{summary.failed}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Page snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-gray-700">
              <div>
                <span className="font-medium text-gray-900">Tab:</span> {tabTitle}
              </div>
              <div className="break-all">
                <span className="font-medium text-gray-900">URL:</span> {data.url}
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Stat label="Word count" value={String(data.wordCount)} />
                <Stat label="H1 count" value={String(data.h1Count)} />
                <Stat label="Internal links" value={String(data.internalLinkCount)} />
                <Stat label="External links" value={String(data.externalLinkCount)} />
              </div>
              <div>
                <span className="font-medium text-gray-900">Title:</span> {data.title ?? "—"}
              </div>
              <div>
                <span className="font-medium text-gray-900">Meta description:</span>{" "}
                {data.metaDescription ?? "—"}
              </div>
              <div className="break-all">
                <span className="font-medium text-gray-900">Canonical:</span> {data.canonical ?? "—"}
              </div>
              <div>
                <span className="font-medium text-gray-900">Meta robots:</span> {data.metaRobots ?? "—"}
              </div>
              <div>
                <span className="font-medium text-gray-900">html lang:</span> {data.htmlLang ?? "—"}
              </div>
              <div>
                <span className="font-medium text-gray-900">Favicon:</span>{" "}
                {data.faviconPresent ? "Detected in head" : "Not found in head"}
              </div>
              <div>
                <span className="font-medium text-gray-900">Open Graph:</span>{" "}
                {[
                  data.ogTitle ? "title" : null,
                  data.ogDescription ? "description" : null,
                  data.ogImage ? "image" : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </div>
              <div>
                <span className="font-medium text-gray-900">Twitter:</span>{" "}
                {[data.twitterCard ? `card=${data.twitterCard}` : null, data.twitterTitle ? "title" : null]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </div>
              <div>
                <span className="font-medium text-gray-900">Schema @type:</span>{" "}
                {data.schemaTypes.length ? data.schemaTypes.join(", ") : "—"}
                {data.schemaParseErrorCount > 0
                  ? ` · ${data.schemaParseErrorCount} JSON-LD parse error(s)`
                  : ""}
              </div>
              {data.imagesMissingAlt.count > 0 ? (
                <div>
                  <span className="font-medium text-gray-900">Images missing alt:</span>{" "}
                  {data.imagesMissingAlt.count}
                  {data.imagesMissingAltSamples.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-500">
                      {data.imagesMissingAltSamples.map((src) => (
                        <li key={src} className="break-all">
                          {src}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {data.imagesMissingDimensionsCount > 0 ? (
                <div>
                  <span className="font-medium text-gray-900">Images missing dimensions:</span>{" "}
                  {data.imagesMissingDimensionsCount}
                  {data.imagesMissingDimensionsSamples.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-500">
                      {data.imagesMissingDimensionsSamples.map((src) => (
                        <li key={`dim-${src}`} className="break-all">
                          {src}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rule results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {rules!.map((rule) => (
                <div
                  key={rule.id}
                  className={`rounded-lg border px-4 py-3 ${
                    rule.passed
                      ? "border-emerald-200 bg-emerald-50"
                      : severityClass[rule.severity]
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">
                      {rule.passed ? "Pass" : "Fail"} · {rule.id}
                    </div>
                    <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold capitalize">
                      {rule.severity}
                    </span>
                  </div>
                  <div className="mt-1 text-sm opacity-90">{rule.description}</div>
                  <div className="mt-2 text-sm font-medium">{rule.message}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-500">
            Open a website in another tab, then click <strong>Analyze active tab</strong>. Extraction
            and rules run entirely in the extension — nothing is sent to the backend.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

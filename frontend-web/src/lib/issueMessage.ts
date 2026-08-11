export type IssueStat = {
  label: string;
  value: string;
};

export type ParsedIssueMessage = {
  /** Short headline without URL dump or trailing advice */
  headline: string;
  /** Parenthetical / inline metrics extracted from the message */
  stats: IssueStat[];
  /** Example / affected URLs */
  urls: string[];
  /** Extra URLs beyond the listed samples, e.g. (+109 more) */
  extraCount: number;
  /** Recommendation or trailing sentence after the URL list */
  advice: string | null;
  /** True when we could structure the message beyond a plain paragraph */
  structured: boolean;
};

const URL_RE = /https?:\/\/[^\s,)<]+/gi;
const LIST_MARKER_RE = /\b(Examples|Affected URLs|Affected pages)\s*:\s*/i;
const EXTRA_MORE_RE = /\(\+(\d+)\s*more\)\.?/i;

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function titleCaseLabel(raw: string): string {
  const normalized = raw
    .replace(/\(s\)/gi, "s")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  if (normalized === "pages") return "Crawled pages";
  if (normalized === "urls") return "URLs compared";
  if (normalized.startsWith("sitemap")) return "Sitemap URLs";
  if (normalized.startsWith("crawled")) return "Crawled pages";
  return normalized.replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractStatsFromParen(parenBody: string): IssueStat[] {
  const stats: IssueStat[] = [];
  const segments = parenBody.split(/[;]/).map((s) => s.trim()).filter(Boolean);
  for (const segment of segments) {
    const match = segment.match(/(\d[\d,]*)\s+(.+?)$/i);
    if (!match) continue;
    const value = match[1].replace(/,/g, "");
    const lower = segment.toLowerCase();
    let label: string;
    if (lower.includes("sitemap compared")) label = "Sitemap compared";
    else if (lower.startsWith("crawled")) label = "Crawled pages";
    else label = titleCaseLabel(match[2]);
    stats.push({ label, value });
  }
  return stats;
}

function extractLeadingCount(headline: string): { headline: string; stats: IssueStat[] } {
  const match = headline.match(
    /^(\d[\d,]*)\s+(sitemap URL\(s\)|crawled URL\(s\)|orphan page\(s\)|[\w\s/-]+?)\s+(were|do|have|was|is)\b(.*)$/i,
  );
  if (!match) return { headline, stats: [] };
  const value = match[1].replace(/,/g, "");
  const label = titleCaseLabel(match[2]);
  return {
    headline, // keep original wording for display
    stats: [{ label, value }],
  };
}

function peelParenStats(summary: string): { summary: string; stats: IssueStat[] } {
  // `(s)` plural markers nest inside the trailing stats paren — neutralize first.
  const masked = summary.replace(/\(s\)/gi, "«s»");
  const paren = masked.match(/\(([^)]+)\)\s*\.?$/);
  if (!paren || paren.index == null) return { summary, stats: [] };
  const body = paren[1].replace(/«s»/gi, "(s)");
  return {
    summary: cleanText(summary.slice(0, paren.index).replace(/[.,;:\s]+$/, "")),
    stats: extractStatsFromParen(body),
  };
}

/**
 * Parse dense backend finding strings into headline / stats / URL samples / advice.
 * Falls back gracefully for short plain messages.
 */
export function parseIssueMessage(message: string): ParsedIssueMessage {
  const raw = cleanText(message || "");
  if (!raw) {
    return {
      headline: "No details provided.",
      stats: [],
      urls: [],
      extraCount: 0,
      advice: null,
      structured: false,
    };
  }

  const marker = raw.match(LIST_MARKER_RE);
  if (marker && marker.index != null) {
    let summary = cleanText(raw.slice(0, marker.index));
    const afterMarker = raw.slice(marker.index + marker[0].length);

    const urls = Array.from(afterMarker.matchAll(URL_RE), (m) =>
      m[0].replace(/[.,;]+$/, ""),
    );
    const uniqueUrls = [...new Set(urls)];

    const extraMatch = afterMarker.match(EXTRA_MORE_RE);
    const extraCount = extraMatch ? Number(extraMatch[1]) : 0;

    let advice: string | null = null;
    if (extraMatch && extraMatch.index != null) {
      advice = cleanText(afterMarker.slice(extraMatch.index + extraMatch[0].length));
    } else if (uniqueUrls.length > 0) {
      const lastUrl = uniqueUrls[uniqueUrls.length - 1];
      const lastIdx = afterMarker.lastIndexOf(lastUrl);
      if (lastIdx >= 0) {
        advice = cleanText(
          afterMarker.slice(lastIdx + lastUrl.length).replace(/^[.,;\s]+/, ""),
        );
      }
    } else {
      advice = cleanText(afterMarker) || null;
    }
    if (!advice) advice = null;

    const peeled = peelParenStats(summary);
    summary = peeled.summary;
    const stats = [...peeled.stats];

    const leading = extractLeadingCount(summary);
    summary = leading.headline;
    for (const stat of leading.stats) {
      if (!stats.some((s) => s.label === stat.label)) stats.unshift(stat);
    }

    return {
      headline: summary || "Finding details",
      stats,
      urls: uniqueUrls,
      extraCount: Number.isFinite(extraCount) ? extraCount : 0,
      advice,
      structured: true,
    };
  }

  const urls = Array.from(raw.matchAll(URL_RE), (m) => m[0].replace(/[.,;]+$/, ""));
  if (urls.length >= 2) {
    let summary = cleanText(
      raw
        .replace(URL_RE, "")
        .replace(/\(\+\d+\s*more\)\.?/gi, "")
        .replace(/\bExamples\b|\bAffected URLs\b|\bAffected pages\b/gi, "")
        .replace(/[,\s]{2,}/g, " ")
        .replace(/[.:\s]+$/g, ""),
    );
    const extraMatch = raw.match(EXTRA_MORE_RE);
    return {
      headline: summary || "Finding details",
      stats: [],
      urls: [...new Set(urls)],
      extraCount: extraMatch ? Number(extraMatch[1]) : 0,
      advice: null,
      structured: true,
    };
  }

  return {
    headline: raw,
    stats: [],
    urls: [],
    extraCount: 0,
    advice: null,
    structured: false,
  };
}

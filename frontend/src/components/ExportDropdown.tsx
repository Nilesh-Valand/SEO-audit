"use client";

import { getApiUrl } from "@/lib/api";

export function ExportDropdown({ crawlRunId }: { crawlRunId: number }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white">
        Export
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-44 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
        <a
          className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          href={getApiUrl(`/api/crawl-runs/${crawlRunId}/export/pdf`)}
          target="_blank"
          rel="noreferrer"
        >
          Export as PDF
        </a>
        <a
          className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          href={getApiUrl(`/api/crawl-runs/${crawlRunId}/export/csv`)}
          target="_blank"
          rel="noreferrer"
        >
          Export as CSV
        </a>
        <a
          className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          href={getApiUrl(`/api/crawl-runs/${crawlRunId}/export/xlsx`)}
          target="_blank"
          rel="noreferrer"
        >
          Export as Excel
        </a>
      </div>
    </details>
  );
}

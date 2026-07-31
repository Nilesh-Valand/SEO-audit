import { ApiError, parseApiErrorBody } from "./errors";
import { getApiBaseUrl } from "./storage";

export type ExportFormat = "pdf" | "csv" | "xlsx";

const EXPORT_META: Record<
  ExportFormat,
  { pathSuffix: string; mime: string; defaultExt: string; timeoutMs: number }
> = {
  pdf: {
    pathSuffix: "pdf",
    mime: "application/pdf",
    defaultExt: "pdf",
    timeoutMs: 180_000,
  },
  csv: {
    pathSuffix: "csv",
    mime: "text/csv",
    defaultExt: "csv",
    timeoutMs: 60_000,
  },
  xlsx: {
    pathSuffix: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    defaultExt: "xlsx",
    timeoutMs: 120_000,
  },
};

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1].trim());
    } catch {
      /* fall through */
    }
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(header);
  if (plainMatch?.[1]) return plainMatch[1].trim();
  return fallback;
}

/**
 * Fetch an export endpoint as a blob and save it via chrome.downloads.download.
 * Blob URLs are required because plain <a download> is unreliable for cross-origin
 * responses inside extension pages.
 */
export async function downloadCrawlExport(
  crawlRunId: number,
  format: ExportFormat,
): Promise<void> {
  const meta = EXPORT_META[format];
  const base = await getApiBaseUrl();
  const path = `/api/crawl-runs/${crawlRunId}/export/${meta.pathSuffix}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), meta.timeoutMs);

  let blobUrl: string | null = null;

  try {
    const res = await fetch(`${base}${path}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, parseApiErrorBody(res.status, text));
    }

    const blob = await res.blob();
    const fallbackName = `crawl-run-${crawlRunId}-export.${meta.defaultExt}`;
    const filename = filenameFromDisposition(
      res.headers.get("Content-Disposition"),
      fallbackName,
    );

    blobUrl = URL.createObjectURL(blob);

    await new Promise<void>((resolve, reject) => {
      chrome.downloads.download(
        {
          url: blobUrl!,
          filename,
          saveAs: false,
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (downloadId === undefined) {
            reject(
              new Error(
                "Download did not start. Check that the downloads permission is granted.",
              ),
            );
            return;
          }
          resolve();
        },
      );
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Export timed out after ${meta.timeoutMs / 1000}s (${format.toUpperCase()})`);
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
    if (blobUrl) {
      window.setTimeout(() => URL.revokeObjectURL(blobUrl!), 60_000);
    }
  }
}

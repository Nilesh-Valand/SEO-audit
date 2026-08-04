import { extractPageSeoData } from "./extractPageSeoData";
import type { PageExtractResult } from "./pageCheckTypes";

function isHttpUrl(url: string | undefined): boolean {
  return Boolean(url && /^https?:\/\//i.test(url));
}

/**
 * Resolve which tab to analyze. When the extension dashboard is focused,
 * fall back to the most recently accessed http(s) tab.
 */
export async function resolveTargetTab(): Promise<chrome.tabs.Tab> {
  const focused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const focusedHttp = focused.find((tab) => isHttpUrl(tab.url));
  if (focusedHttp?.id != null) return focusedHttp;

  const all = await chrome.tabs.query({});
  const httpTabs = all
    .filter((tab) => isHttpUrl(tab.url) && !tab.url?.startsWith("chrome-extension://"))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));

  const activeHttp = httpTabs.find((tab) => tab.active);
  if (activeHttp?.id != null) return activeHttp;
  if (httpTabs[0]?.id != null) return httpTabs[0];

  throw new Error(
    "No analyzable http(s) tab found. Open a website in another tab, then try again.",
  );
}

export async function analyzeActiveTab(): Promise<{
  tab: chrome.tabs.Tab;
  data: PageExtractResult;
}> {
  const tab = await resolveTargetTab();
  if (tab.id == null) {
    throw new Error("Target tab has no id.");
  }

  if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://") || tab.url?.startsWith("edge://")) {
    throw new Error("Cannot inject into browser internal pages. Open a normal website tab.");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageSeoData,
  });

  const data = results[0]?.result;
  if (!data) {
    throw new Error("Content script returned no data. The page may block script injection.");
  }

  return { tab, data };
}

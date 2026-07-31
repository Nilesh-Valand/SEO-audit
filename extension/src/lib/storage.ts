export const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
export const STORAGE_KEY_API_BASE = "apiBaseUrl";
export const STORAGE_KEY_SELECTED_PROJECT = "selectedProjectId";
export const STORAGE_KEY_SELECTED_RUN = "selectedCrawlRunId";

export async function getApiBaseUrl(): Promise<string> {
  const result = await chrome.storage.local.get(STORAGE_KEY_API_BASE);
  const value = result[STORAGE_KEY_API_BASE];
  if (typeof value === "string" && value.trim()) {
    return value.trim().replace(/\/$/, "");
  }
  return DEFAULT_API_BASE_URL;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  const normalized = url.trim().replace(/\/$/, "");
  await chrome.storage.local.set({ [STORAGE_KEY_API_BASE]: normalized });
}

export type SelectedAudit = {
  projectId: number | null;
  crawlRunId: number | null;
};

export async function getSelectedAudit(): Promise<SelectedAudit> {
  const result = await chrome.storage.local.get([
    STORAGE_KEY_SELECTED_PROJECT,
    STORAGE_KEY_SELECTED_RUN,
  ]);
  const projectId = result[STORAGE_KEY_SELECTED_PROJECT];
  const crawlRunId = result[STORAGE_KEY_SELECTED_RUN];
  return {
    projectId: typeof projectId === "number" ? projectId : null,
    crawlRunId: typeof crawlRunId === "number" ? crawlRunId : null,
  };
}

export async function setSelectedAudit(selection: {
  projectId: number;
  crawlRunId: number;
}): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY_SELECTED_PROJECT]: selection.projectId,
    [STORAGE_KEY_SELECTED_RUN]: selection.crawlRunId,
  });
}

export async function clearSelectedAudit(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEY_SELECTED_PROJECT, STORAGE_KEY_SELECTED_RUN]);
}

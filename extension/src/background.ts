const DASHBOARD_PATH = "index.html";

chrome.action.onClicked.addListener(async () => {
  const dashboardUrl = chrome.runtime.getURL(DASHBOARD_PATH);

  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => {
    if (!tab.url) return false;
    return tab.url === dashboardUrl || tab.url.startsWith(`${dashboardUrl}#`);
  });

  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url: dashboardUrl });
});

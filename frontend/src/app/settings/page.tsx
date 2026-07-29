"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getApiUrl } from "@/lib/api";

const STORAGE_KEYS = {
  defaultMaxPages: "seo_audit_default_max_pages",
  defaultEnablePagespeed: "seo_audit_default_enable_pagespeed",
};

type ConnectionState = "checking" | "online" | "offline";

export default function SettingsPage() {
  const [defaultMaxPages, setDefaultMaxPages] = useState(200);
  const [defaultEnablePagespeed, setDefaultEnablePagespeed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [apiBase, setApiBase] = useState("");

  useEffect(() => {
    const maxPagesRaw = window.localStorage.getItem(STORAGE_KEYS.defaultMaxPages);
    const pagespeedRaw = window.localStorage.getItem(STORAGE_KEYS.defaultEnablePagespeed);
    if (maxPagesRaw) {
      const parsed = Number(maxPagesRaw);
      if (!Number.isNaN(parsed) && parsed > 0) setDefaultMaxPages(parsed);
    }
    if (pagespeedRaw !== null) {
      setDefaultEnablePagespeed(pagespeedRaw === "true");
    }

    setApiBase(getApiUrl(""));

    async function checkHealth() {
      try {
        const res = await fetch(getApiUrl("/api/health"), { cache: "no-store" });
        setConnection(res.ok ? "online" : "offline");
      } catch {
        setConnection("offline");
      }
    }

    void checkHealth();
  }, []);

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.localStorage.setItem(STORAGE_KEYS.defaultMaxPages, String(defaultMaxPages));
    window.localStorage.setItem(
      STORAGE_KEYS.defaultEnablePagespeed,
      String(defaultEnablePagespeed),
    );
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Local preferences and backend connection details for this workspace.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <div>
              <div className="font-medium text-gray-900">Backend status</div>
              <div className="mt-1 text-gray-500 break-all">{apiBase || "Loading…"}</div>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                connection === "online"
                  ? "bg-emerald-100 text-emerald-800"
                  : connection === "offline"
                    ? "bg-red-100 text-red-800"
                    : "bg-amber-100 text-amber-800"
              }`}
            >
              {connection === "checking" ? "Checking…" : connection}
            </span>
          </div>
          <p className="text-gray-500">
            Change the API URL in <code className="rounded bg-gray-100 px-1">frontend/.env.local</code>{" "}
            (`NEXT_PUBLIC_API_BASE_URL`) and restart the frontend.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>New audit defaults</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Default max pages</label>
              <Input
                type="number"
                min={1}
                max={5000}
                value={defaultMaxPages}
                onChange={(event) => setDefaultMaxPages(Number(event.target.value))}
              />
            </div>

            <label className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={defaultEnablePagespeed}
                onChange={(event) => setDefaultEnablePagespeed(event.target.checked)}
              />
              Enable PageSpeed by default on new audits
            </label>

            <div className="flex items-center gap-3">
              <Button type="submit">Save preferences</Button>
              {saved ? <span className="text-sm text-emerald-700">Saved</span> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enrichment integrations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-600">
          <p>
            PageSpeed and Google Search Console are controlled by backend flags in{" "}
            <code className="rounded bg-gray-100 px-1">backend/.env</code>:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <code className="rounded bg-gray-100 px-1">ENRICHMENT_ENABLE_PAGESPEED</code> — set to{" "}
              <code className="rounded bg-gray-100 px-1">true</code> and add{" "}
              <code className="rounded bg-gray-100 px-1">PAGESPEED_API_KEY</code> to collect CWV metrics.
            </li>
            <li>
              <code className="rounded bg-gray-100 px-1">ENRICHMENT_ENABLE_GSC</code> — set to{" "}
              <code className="rounded bg-gray-100 px-1">true</code> and configure Google OAuth credentials
              to pull Search Console data. Sitemap comparison still runs without GSC.
            </li>
          </ul>
          <p>
            With both flags off, audits still produce full crawl-based reports (titles, links, content,
            sitemap gaps, and more).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

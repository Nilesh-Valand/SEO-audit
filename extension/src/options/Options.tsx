import { FormEvent, useEffect, useState } from "react";
import { apiClient } from "../lib/api";
import { formatBackendError } from "../lib/errors";
import { DEFAULT_API_BASE_URL, getApiBaseUrl, setApiBaseUrl } from "../lib/storage";

export default function Options() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE_URL);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);

  useEffect(() => {
    void getApiBaseUrl().then(setApiBase);
  }, []);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    await setApiBaseUrl(apiBase);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  async function handleTest() {
    setTesting(true);
    setTestMessage(null);
    setTestOk(null);
    try {
      await setApiBaseUrl(apiBase);
      const health = await apiClient.health();
      setTestOk(true);
      setTestMessage(`Connected. Backend status: ${health.status}`);
    } catch (error) {
      setTestOk(false);
      setTestMessage(await formatBackendError(error));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold text-gray-900">SEO Audit Options</h1>
      <p className="mt-1 text-sm text-gray-500">Backend URL used for all API calls from the extension.</p>

      <form onSubmit={handleSave} className="mt-8 space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">API base URL</label>
          <input
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            value={apiBase}
            onChange={(event) => setApiBase(event.target.value)}
            placeholder={DEFAULT_API_BASE_URL}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testing}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
          >
            {testing ? "Testing…" : "Test Connection"}
          </button>
          {saved ? <span className="text-sm text-emerald-700">Saved</span> : null}
        </div>

        {testMessage ? (
          <div
            className={`rounded-lg px-4 py-3 text-sm ${
              testOk ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
            }`}
          >
            {testMessage}
          </div>
        ) : null}
      </form>
    </div>
  );
}

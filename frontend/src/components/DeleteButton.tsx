"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClient } from "@/lib/api";

type DeleteTarget =
  | { type: "project"; id: number; label: string }
  | { type: "crawl_run"; id: number; label: string };

export function DeleteButton({
  target,
  redirectTo,
  className = "",
}: {
  target: DeleteTarget;
  redirectTo?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    const confirmed = window.confirm(
      target.type === "project"
        ? `Delete project "${target.label}" and all of its audit runs? This cannot be undone.`
        : `Delete ${target.label}? This cannot be undone.`,
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      if (target.type === "project") {
        await apiClient.deleteProject(target.id);
      } else {
        await apiClient.deleteCrawlRun(target.id);
      }
      if (redirectTo) {
        router.push(redirectTo);
      }
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to delete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleDelete}
      className={`rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 ${className}`}
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}

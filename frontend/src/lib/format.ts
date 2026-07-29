export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return "—";
  return String(Math.round(score));
}

export function statusClass(status: string): string {
  const key = status.toLowerCase();
  if (key === "completed") return "bg-emerald-100 text-emerald-800";
  if (key === "failed") return "bg-red-100 text-red-800";
  if (key === "running" || key === "enriching") return "bg-sky-100 text-sky-800";
  if (key === "pending") return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-700";
}

export function ProgressBar({
  value,
  label,
}: {
  value: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="space-y-2">
      {label ? <div className="text-sm text-gray-600">{label}</div> : null}
      <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-brand-600 transition-all duration-300"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const key = status.toLowerCase();
  const className =
    key === "completed"
      ? "bg-emerald-100 text-emerald-800"
      : key === "failed"
        ? "bg-red-100 text-red-800"
        : key === "running" || key === "enriching"
          ? "bg-sky-100 text-sky-800"
          : "bg-amber-100 text-amber-800";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${className}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

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

export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

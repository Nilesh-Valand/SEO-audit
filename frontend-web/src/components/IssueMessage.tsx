import { ExternalLink } from "lucide-react";
import { parseIssueMessage } from "@/lib/issueMessage";

type IssueMessageProps = {
  message: string;
  /** Compact headline-only for list rows; full breakdown when expanded */
  variant?: "headline" | "full";
  className?: string;
};

export function IssueMessage({
  message,
  variant = "full",
  className = "",
}: IssueMessageProps) {
  const parsed = parseIssueMessage(message);

  if (variant === "headline") {
    return (
      <p className={`text-sm font-semibold leading-snug text-slate-900 ${className}`}>
        {parsed.headline}
        {parsed.urls.length > 0 ? (
          <span className="ml-1.5 font-medium text-slate-500">
            · {parsed.urls.length + parsed.extraCount} URL
            {parsed.urls.length + parsed.extraCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </p>
    );
  }

  if (!parsed.structured) {
    return (
      <p className={`text-sm leading-relaxed text-slate-700 ${className}`}>{parsed.headline}</p>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <p className="text-sm font-semibold leading-snug text-slate-900">{parsed.headline}</p>

      {parsed.stats.length > 0 ? (
        <dl className="grid gap-2 sm:grid-cols-3">
          {parsed.stats.map((stat) => (
            <div
              key={`${stat.label}-${stat.value}`}
              className="rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-sm"
            >
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {stat.label}
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {parsed.urls.length > 0 ? (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Example URLs
            {parsed.extraCount > 0 ? (
              <span className="ml-1.5 normal-case tracking-normal text-slate-500">
                (+{parsed.extraCount} more)
              </span>
            ) : null}
          </div>
          <ul className="mt-2 space-y-1.5">
            {parsed.urls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex max-w-full items-start gap-1.5 break-all text-sm text-sky-700 hover:text-sky-800 hover:underline"
                >
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60 group-hover:opacity-100" />
                  <span>{url}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {parsed.advice ? (
        <p className="rounded-xl border border-amber-100 bg-amber-50/80 px-3.5 py-2.5 text-sm leading-relaxed text-amber-950">
          {parsed.advice}
        </p>
      ) : null}
    </div>
  );
}

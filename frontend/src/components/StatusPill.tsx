import { statusClass } from "@/lib/format";

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusClass(status)}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

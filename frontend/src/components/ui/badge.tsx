const severityClasses: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-sky-100 text-sky-800",
};

export function Badge({ value }: { value: string }) {
  const key = value.toLowerCase();
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${severityClasses[key] ?? "bg-gray-100 text-gray-700"}`}>
      {value}
    </span>
  );
}

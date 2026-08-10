import Link from "next/link";

export function BackendUnreachable({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
      <p className="font-medium">{message}</p>
      <Link href="/settings" className="mt-3 inline-block font-semibold text-brand-700 hover:underline">
        Open Settings →
      </Link>
    </div>
  );
}

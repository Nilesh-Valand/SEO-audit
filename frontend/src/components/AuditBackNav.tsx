import Link from "next/link";

export function AuditBackNav({
  auditId,
  projectId,
  active,
}: {
  auditId: number;
  projectId?: number | null;
  active?: "report" | "issues" | "pages";
}) {
  const linkClass = (key: string) =>
    `text-sm font-medium hover:underline ${
      active === key ? "text-brand-700" : "text-brand-600"
    }`;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 print:hidden">
      <Link href="/reports" className="text-sm font-medium text-brand-600 hover:underline">
        ← Back to reports
      </Link>
      {projectId ? (
        <>
          <span className="text-gray-300">|</span>
          <Link
            href={`/dashboard/${projectId}`}
            className="text-sm font-medium text-brand-600 hover:underline"
          >
            Project dashboard
          </Link>
        </>
      ) : null}
      <span className="text-gray-300">|</span>
      <Link href={`/audits/${auditId}/report`} className={linkClass("report")}>
        Report
      </Link>
      <Link href={`/audits/${auditId}/issues`} className={linkClass("issues")}>
        Issues
      </Link>
      <Link href={`/audits/${auditId}/pages`} className={linkClass("pages")}>
        Pages
      </Link>
    </div>
  );
}

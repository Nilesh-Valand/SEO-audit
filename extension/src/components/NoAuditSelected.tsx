import { Link } from "react-router-dom";
import { Card, CardContent } from "./ui";

export function NoAuditSelected() {
  return (
    <Card>
      <CardContent className="space-y-3 py-8 text-sm text-gray-600">
        <p>Select a crawl run from Projects, or start a new audit.</p>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/audits/new"
            className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            New Audit
          </Link>
          <Link
            to="/projects"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50"
          >
            Projects
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

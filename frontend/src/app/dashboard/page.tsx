import { redirect } from "next/navigation";
import { apiClient } from "@/lib/api";

export default async function DashboardRedirectPage() {
  try {
    const projects = await apiClient.listProjects({ page: 1, page_size: 1 });
    if (projects.items.length > 0) {
      redirect(`/dashboard/${projects.items[0].id}`);
    }
  } catch {
    // If the API is unavailable, route the user to the audit creation flow.
  }

  redirect("/audits/new");
}

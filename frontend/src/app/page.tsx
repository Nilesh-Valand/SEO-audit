import { redirect } from "next/navigation";
import { apiClient } from "@/lib/api";

export default async function Home() {
  try {
    const projects = await apiClient.listProjects({ page: 1, page_size: 1 });
    if (projects.items.length > 0) {
      redirect(`/dashboard/${projects.items[0].id}`);
    }
  } catch {
    // Fall through to the new audit screen if the API is unavailable.
  }

  redirect("/audits/new");
}

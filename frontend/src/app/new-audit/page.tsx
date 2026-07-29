import { redirect } from "next/navigation";

export default function LegacyNewAuditPage() {
  redirect("/audits/new");
}

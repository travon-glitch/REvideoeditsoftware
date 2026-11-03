import { redirect } from "next/navigation";

/* The company videos list became the company video library (Stage 13). */
export default function CompanyProjectsPage() {
  redirect("/admin/library");
}

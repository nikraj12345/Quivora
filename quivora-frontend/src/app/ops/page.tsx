import { redirect } from "next/navigation";

/** Ops hub replaced by the live board — fewer clicks. */
export default function OperationsDashboardPage() {
  redirect("/reception");
}

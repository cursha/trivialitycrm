import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";

export default async function RootPage() {
  await requireUser();
  redirect("/dashboard");
}

import DashboardShell from "@/components/dashboard/DashboardShell";
import { requireProfile } from "@/lib/access";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  return <DashboardShell profile={profile}>{children}</DashboardShell>;
}

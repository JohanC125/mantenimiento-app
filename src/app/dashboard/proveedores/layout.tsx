import { requireProfile } from "@/lib/access";
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireProfile(true);
  return children;
}

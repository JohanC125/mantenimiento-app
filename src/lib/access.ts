import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function requireProfile(adminOnly = false) {
  const client = await createServerSupabaseClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) redirect("/login");
  const { data: profile } = await client.from("profiles")
    .select("id, full_name, role, active").eq("id", user.id).single();
  if (!profile?.active || !["administrador", "auxiliar", "planeador"].includes(profile.role)) redirect("/login");
  if (adminOnly && profile.role !== "administrador") redirect("/dashboard");
  return profile;
}

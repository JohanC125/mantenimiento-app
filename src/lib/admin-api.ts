import { createServerSupabaseClient } from "@/lib/supabase/server";
export async function adminSession() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: Response.json({ error: "No autenticado" }, { status: 401 }) };
  const { data: profile, error: profileError } = await supabase.from("profiles").select("role, active").eq("id", user.id).single();
  if (profileError || !profile?.active || profile.role !== "administrador") return { response: Response.json({ error: "Acceso exclusivo de administradores" }, { status: 403 }) };
  return { supabase, user };
}

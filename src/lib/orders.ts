import { supabase } from "@/lib/supabase";

// Read every visible page; never present the first 100 rows as a global total.
// RLS is applied to each page and engineers are additionally scoped by assignee.
export async function readVisibleOrders() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw error || new Error("No hay sesión activa.");
  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("role, active").eq("id", user.id).single();
  if (profileError || !profile?.active) throw profileError || new Error("Perfil inactivo.");
  const rows = [];
  const size = 500;
  for (let offset = 0; ; offset += size) {
    const query = supabase.from("maintenance_orders")
      .select("*, sites(name, requires_coproperty), creator:profiles!maintenance_orders_created_by_fkey(full_name, role)")
      .order("id", { ascending: false }).range(offset, offset + size - 1);
    const result = await query;
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < size) break;
  }
  return { data: rows, error: null };
}

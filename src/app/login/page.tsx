import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase.from("profiles")
      .select("role, active").eq("id", user.id).single();
    if (profile?.active && ["administrador", "planeador", "auxiliar"].includes(profile.role)) {
      redirect("/dashboard");
    }
    return <LoginForm initialError="Tu cuenta no está activa. Contacta a un administrador." />;
  }
  return <LoginForm />;
}

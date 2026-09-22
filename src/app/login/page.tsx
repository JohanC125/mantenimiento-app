import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");
  return <LoginForm />;
}

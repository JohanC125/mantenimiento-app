"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AppBrand, AppIcon } from "@/components/ui/AppIcon";

export default function LoginForm({ initialError = "" }: { initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [loading, setLoading] = useState(false); const [error, setError] = useState(initialError);
  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }
    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("role, active").eq("id", result.data.user.id).single();
    if (profileError || !profile?.active || !["administrador", "planeador", "auxiliar"].includes(profile.role)) {
      await supabase.auth.signOut();
      setError(profileError ? "No se pudo verificar tu perfil. Intenta de nuevo." : "Tu cuenta no está activa. Contacta a un administrador.");
      setLoading(false);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  };
  return (
    <main className="grid min-h-dvh bg-[#07111f] lg:grid-cols-[46%_54%]">
      <section className="app-hero relative hidden min-h-dvh flex-col justify-between overflow-hidden border-r border-blue-400/15 px-12 py-10 lg:flex xl:px-16">
        <div aria-hidden className="app-grid-pattern pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative z-10"><AppBrand /></div>
        <div className="relative z-10 max-w-xl">
          <p className="mb-3 text-xs font-bold uppercase tracking-[.28em] text-blue-300">Plataforma operativa</p>
          <h1 className="text-5xl font-bold leading-tight tracking-tight text-white xl:text-6xl">El control de tus órdenes, en un solo lugar.</h1>
          <p className="mt-6 max-w-md text-base leading-7 text-slate-300">Gestiona tus órdenes de mantenimiento de forma simple, segura y centralizada.</p>
        </div>
        <p className="relative z-10 text-xs text-slate-400">OT Mantenimiento · Gestión de órdenes</p>
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-28 h-96 w-96 rounded-full border border-blue-300/10 bg-blue-500/10 blur-3xl" />
      </section>
      <section className="flex min-h-dvh items-center justify-center px-5 py-10 sm:px-8 lg:px-14">
        <div className="w-full max-w-md">
          <div className="mb-9 lg:hidden"><AppBrand /><p className="mt-7 text-sm leading-6 text-slate-400">Gestiona tus órdenes de mantenimiento de forma simple, segura y centralizada.</p></div>
          <div className="app-card p-6 shadow-[0_30px_70px_rgba(0,0,0,.28)] sm:p-9">
            <div className="mb-8"><p className="mb-2 text-xs font-bold uppercase tracking-[.2em] text-blue-300">Acceso seguro</p><h2 className="text-3xl font-bold tracking-tight text-slate-50">Bienvenido</h2><p className="mt-2 text-sm text-slate-400">Ingresa tus credenciales para continuar.</p></div>
            <form onSubmit={handleLogin} className="space-y-5">
              <label className="block text-sm font-medium text-slate-200">Correo electrónico<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="correo@empresa.com" required className="app-field mt-2 w-full px-4 py-3" /></label>
              <label className="block text-sm font-medium text-slate-200">Contraseña<input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="••••••••" required className="app-field mt-2 w-full px-4 py-3" /></label>
              {error && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
              <button type="submit" disabled={loading} className="app-button-primary min-h-12 w-full px-5 py-3">{loading ? "Ingresando…" : <><span>Iniciar sesión</span><AppIcon name="arrow" className="h-4 w-4" /></>}</button>
            </form>
          </div>
          <p className="mt-6 text-center text-xs text-slate-500">Acceso exclusivo para personal autorizado.</p>
        </div>
      </section>
    </main>
  );
}

"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const handleLogin = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (loading) return; setLoading(true); setError(""); const result = await supabase.auth.signInWithPassword({ email, password }); if (result.error) { setError(result.error.message); setLoading(false); return; } router.replace("/dashboard"); router.refresh(); };
  return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6"><div className="w-full max-w-md"><div className="rounded-2xl bg-white p-8 shadow-xl"><div className="mb-8 text-center"><h1 className="text-3xl font-bold text-slate-900">Mantenimiento App</h1><p className="mt-2 text-slate-500">Gestión de órdenes de mantenimiento</p></div><form onSubmit={handleLogin} className="space-y-5"><label className="block text-sm font-medium text-slate-700">Correo<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="correo@empresa.com" required className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-500" /></label><label className="block text-sm font-medium text-slate-700">Contraseña<input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="••••••••" required className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-500" /></label>{error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}<button type="submit" disabled={loading} className="w-full rounded-lg bg-slate-900 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50">{loading ? "Ingresando..." : "Ingresar"}</button></form></div></div></main>;
}

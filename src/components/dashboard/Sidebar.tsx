"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { AppBrand, AppIcon } from "@/components/ui/AppIcon";

type Role = "auxiliar" | "planeador" | "administrador";

type Profile = {
  full_name: string;
  role: Role;
};

const navigation = [
  {
    name: "Inicio",
    href: "/dashboard",
    icon: "home",
    roles: ["auxiliar", "planeador", "administrador"],
  },
  {
    name: "Sedes",
    href: "/dashboard/sedes",
    icon: "site",
    roles: ["administrador"],
  },
  {
    name: "Usuarios",
    href: "/dashboard/usuarios",
    icon: "users",
    roles: ["administrador"],
  },
] as const;

export default function Sidebar({ profile, collapsed }: { profile: Profile; collapsed: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    const { error } = await supabase.auth.signOut();
    if (error) { setLogoutError("No se pudo cerrar la sesión. Reintenta."); setLoggingOut(false); return; }
    router.replace("/"); router.refresh();
  };

  const visibleNavigation = navigation.filter((item) =>
    profile?.role ? (item.roles as readonly string[]).includes(profile.role) : false,
  );

  return (
    <aside id="dashboard-sidebar" className={`sticky top-0 hidden h-dvh shrink-0 self-start flex-col overflow-y-auto overflow-x-hidden border-r border-white/10 bg-[#07101c] transition-[width] duration-200 ease-in-out lg:flex ${collapsed ? "w-20" : "w-72"}`}>
      {/* LOGO */}
      <div className={`border-b border-white/10 py-6 transition-[padding] duration-200 ${collapsed ? "px-4" : "px-5"}`}>
        <Link href="/dashboard" title={collapsed ? "OT Mantenimiento · Inicio" : undefined} aria-label={collapsed ? "OT Mantenimiento · Inicio" : undefined} className="block rounded-xl"><AppBrand compact={collapsed} /></Link>
      </div>

      {/* NAVEGACIÓN */}
      <nav className="flex-1 px-3 py-6">
        <p aria-hidden={collapsed} className={`mb-3 overflow-hidden whitespace-nowrap px-4 text-[11px] font-semibold uppercase tracking-[.18em] text-slate-500 transition-[max-height,opacity,margin] duration-200 ${collapsed ? "max-h-0 opacity-0" : "max-h-6 opacity-100"}`}>
          Espacio de trabajo
        </p>

        <div className="space-y-1">
          {visibleNavigation.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.name : undefined}
                aria-label={collapsed ? item.name : undefined}
                className={`flex items-center rounded-xl border py-2.5 text-sm font-medium transition-[background-color,border-color,color,padding] duration-200 ${collapsed ? "justify-center px-2" : "gap-3 px-3"} ${
                  isActive
                    ? "border-blue-400/30 bg-blue-500/13 text-blue-200 shadow-[inset_0_0_0_1px_rgba(38,132,255,.05)]"
                    : "border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-100"
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                    isActive
                      ? "bg-blue-500/17 text-blue-300"
                      : "bg-white/5 text-slate-400"
                  }`}
                >
                  <AppIcon name={item.icon} className="h-4 w-4" />
                </span>

                <span aria-hidden={collapsed} className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ${collapsed ? "max-w-0 opacity-0" : "max-w-32 opacity-100"}`}>{item.name}</span>

                {isActive && (
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full bg-blue-400 shadow-[0_0_10px_rgba(38,132,255,.6)] transition-[max-width,opacity,margin] duration-200 ${collapsed ? "max-w-0 opacity-0" : "ml-auto max-w-2 opacity-100"}`} />
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* USUARIO */}
      <div className={`border-t border-white/10 transition-[padding] duration-200 ${collapsed ? "p-2" : "p-4"}`}>
        <div title={collapsed ? `${profile.full_name || "Usuario"} · ${profile.role}` : undefined} className={`mb-3 flex items-center rounded-xl border border-white/10 bg-white/[.035] p-3 ${collapsed ? "justify-center" : "gap-3"}`}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-sm font-bold text-blue-200">{profile.full_name?.charAt(0).toUpperCase() || "U"}</span>
          <div aria-hidden={collapsed} className={`min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ${collapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100"}`}><p className="truncate text-sm font-semibold text-slate-100">{profile.full_name || "Usuario"}</p><p className="text-xs capitalize text-slate-400">{profile.role}</p></div>
        </div>

        {logoutError && <p role="alert" title={collapsed ? logoutError : undefined} className={`text-sm text-red-700 ${collapsed ? "sr-only" : ""}`}>{logoutError}</p>}
        <button
          type="button"
          disabled={loggingOut}
          onClick={handleLogout}
          title={collapsed ? "Cerrar sesión" : undefined}
          aria-label={collapsed ? "Cerrar sesión" : undefined}
          className={`flex w-full items-center rounded-xl py-3 text-sm font-medium text-slate-400 transition hover:bg-red-500/10 hover:text-red-200 ${collapsed ? "justify-center px-2" : "gap-3 px-3"}`}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5"><AppIcon name="logout" className="h-4 w-4" /></span>
          <span aria-hidden={collapsed} className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ${collapsed ? "max-w-0 opacity-0" : "max-w-36 opacity-100"}`}>{loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}</span>
        </button>
      </div>
    </aside>
  );
}

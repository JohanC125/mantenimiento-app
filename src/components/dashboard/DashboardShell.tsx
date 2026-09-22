"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import Sidebar from "./Sidebar";
import { supabase } from "@/lib/supabase";
import DashboardDataProvider, { type DashboardProfile } from "./DashboardDataProvider";

const navigation = [
  {
    name: "Inicio",
    href: "/dashboard",
    icon: "⌂",
    roles: ["auxiliar", "planeador", "administrador"],
  },
  {
    name: "Sedes",
    href: "/dashboard/sedes",
    icon: "⌂",
    roles: ["administrador"],
  },
  {
    name: "Usuarios",
    href: "/dashboard/usuarios",
    icon: "♙",
    roles: ["administrador"],
  },
] as const;

export default function DashboardShell({
  children,
  profile,
}: {
  children: React.ReactNode;
  profile: DashboardProfile;
}) {
  const pathname = usePathname();

  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const visibleNavigation = navigation.filter((item) =>
    profile?.role ? (item.roles as readonly string[]).includes(profile.role) : false,
  );

  return (
    <DashboardDataProvider profile={profile}><div className="min-h-screen bg-slate-50">
      <div className="flex min-h-screen">
        {/* SIDEBAR PC */}
        <Sidebar profile={profile} />

        {/* CONTENIDO */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* HEADER */}
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
            <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
              {/* BOTÓN MÓVIL */}
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-700 transition hover:bg-slate-200 lg:hidden"
                aria-label="Abrir menú"
              >
                ☰
              </button>

              <div className="hidden lg:block">
                <p className="text-sm font-medium text-slate-500">
                  Gestión de mantenimiento
                </p>
              </div>

              {/* USUARIO */}
              <div className="ml-auto flex items-center gap-3">
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-semibold text-slate-900">
                    {profile?.full_name || "Usuario"}
                  </p>

                  <p className="text-xs capitalize text-slate-500">
                    {profile?.role || ""}
                  </p>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                  {profile?.full_name
                    ? profile.full_name.charAt(0).toUpperCase()
                    : "U"}
                </div>
              </div>
            </div>
          </header>

          {/* CONTENIDO DE CADA PÁGINA */}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>

      {/* OVERLAY MÓVIL */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-slate-950/40"
          />

          <aside className="relative flex h-dvh w-[85%] max-w-sm flex-col overflow-y-auto bg-white shadow-2xl">
            {/* CABECERA */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-5">
              <Link
                href="/dashboard"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 font-bold text-white">
                  M
                </div>

                <div>
                  <p className="font-bold text-slate-900">Mantenimiento</p>

                  <p className="text-xs text-slate-500">Gestión operativa</p>
                </div>
              </Link>

              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-lg text-slate-600"
              >
                ×
              </button>
            </div>

            {/* LINKS */}
            <nav className="flex-1 px-4 py-6">
              <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Aplicativo
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
                      onClick={() => setMenuOpen(false)}
                      className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium ${
                        isActive
                          ? "bg-blue-50 text-blue-700"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                        {item.icon}
                      </span>

                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </nav>

            {/* USUARIO */}
            <div className="border-t border-slate-200 p-4">
              {logoutError && <p role="alert" className="text-sm text-red-700">{logoutError}</p>}
              <div className="mb-3 rounded-2xl bg-slate-50 p-4">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {profile?.full_name || "Usuario"}
                </p>

                <p className="mt-1 text-xs capitalize text-slate-500">
                  {profile?.role || ""}
                </p>
              </div>

              <button
                type="button"
                disabled={loggingOut}
                onClick={async () => {
                  if (loggingOut) return;
                  setLoggingOut(true);
                  setLogoutError("");
                  const { error } = await supabase.auth.signOut();
                  if (error) { setLogoutError("No se pudo cerrar la sesión. Reintenta."); setLoggingOut(false); return; }
                  router.replace("/"); router.refresh();
                }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <span>↪</span>
                {loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div></DashboardDataProvider>
  );
}

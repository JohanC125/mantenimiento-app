"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

type Role = "auxiliar" | "planeador" | "administrador";

type Profile = {
  full_name: string;
  role: Role;
};

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

export default function Sidebar({ profile }: { profile: Profile }) {
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
    <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 self-start flex-col overflow-y-auto border-r border-slate-200 bg-white lg:flex">
      {/* LOGO */}
      <div className="border-b border-slate-200 px-6 py-6">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-lg font-bold text-white shadow-sm">
            M
          </div>

          <div>
            <p className="text-base font-bold text-slate-900">Mantenimiento</p>

            <p className="text-xs text-slate-500">Gestión operativa</p>
          </div>
        </Link>
      </div>

      {/* NAVEGACIÓN */}
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
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition ${
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg text-base ${
                    isActive
                      ? "bg-blue-100 text-blue-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {item.icon}
                </span>

                <span>{item.name}</span>

                {isActive && (
                  <span className="ml-auto h-2 w-2 rounded-full bg-blue-600" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* USUARIO */}
      <div className="border-t border-slate-200 p-4">
        <div className="mb-3 rounded-2xl bg-slate-50 p-4">
          <p className="truncate text-sm font-semibold text-slate-900">
            {profile.full_name || "Usuario"}
          </p>

          <p className="mt-1 text-xs capitalize text-slate-500">
            {profile?.role || ""}
          </p>
        </div>

        {logoutError && <p role="alert" className="text-sm text-red-700">{logoutError}</p>}
        <button
          type="button"
          disabled={loggingOut}
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-600"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
            ↪
          </span>
          {loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
        </button>
      </div>
    </aside>
  );
}

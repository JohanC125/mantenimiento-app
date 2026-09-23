"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import Sidebar from "./Sidebar";
import { supabase } from "@/lib/supabase";
import DashboardDataProvider, { type DashboardProfile } from "./DashboardDataProvider";
import { logSupabaseError } from "@/lib/errors";
import { AppBrand, AppIcon } from "@/components/ui/AppIcon";

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

const desktopBreakpoint = "(min-width: 1024px)";
function subscribeToDesktopBreakpoint(onChange: () => void) {
  const media = window.matchMedia(desktopBreakpoint);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function isDesktopViewport() {
  return window.matchMedia(desktopBreakpoint).matches;
}

export default function DashboardShell({
  children,
  profile,
}: {
  children: React.ReactNode;
  profile: DashboardProfile;
}) {
  const pathname = usePathname();
  const isDesktop = useSyncExternalStore(subscribeToDesktopBreakpoint, isDesktopViewport, () => false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const router = useRouter();
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [clock, setClock] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setClock(new Date());
    update();
    const timer = window.setInterval(update, 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false); };
    window.addEventListener("keydown", close);
    desktop.addEventListener("change", closeOnDesktop);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", close); desktop.removeEventListener("change", closeOnDesktop); };
  }, [menuOpen]);
  useEffect(() => {
    let current = true;
    void Promise.resolve(supabase.from("profiles").select("active").eq("id", profile.id).single())
      .then(async ({ data, error }) => {
        if (!current) return;
        if (error) {
          logSupabaseError("Verificación de cuenta activa", error);
          return;
        }
        if (data?.active) return;
        await supabase.auth.signOut();
        if (!current) return;
        router.replace("/login");
        router.refresh();
      })
      .catch((error) => {
        if (current) logSupabaseError("Verificación de cuenta activa", error);
      });
    return () => { current = false; };
  }, [pathname, profile.id, router]);
  const visibleNavigation = navigation.filter((item) =>
    profile?.role ? (item.roles as readonly string[]).includes(profile.role) : false,
  );

  return (
    <DashboardDataProvider profile={profile}><div className="app-page min-h-screen">
      <div className="flex min-h-screen">
        {/* SIDEBAR PC */}
        <Sidebar profile={profile} collapsed={sidebarCollapsed} />

        {/* CONTENIDO */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* HEADER */}
          <header className="sticky top-0 z-30 border-b border-white/10 bg-[#081523]/95 backdrop-blur-xl">
            <div className="flex min-h-18 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
              {/* Un único control: drawer en móvil, sidebar colapsable en escritorio. */}
              <button
                type="button"
                onClick={() => {
                  if (isDesktopViewport()) setSidebarCollapsed((current) => !current);
                  else setMenuOpen((current) => !current);
                }}
                className="app-button-secondary h-10 w-10 shrink-0"
                aria-label={isDesktop ? (sidebarCollapsed ? "Expandir menú lateral" : "Contraer menú lateral") : (menuOpen ? "Cerrar menú" : "Abrir menú")}
                aria-expanded={isDesktop ? !sidebarCollapsed : menuOpen}
                aria-controls={isDesktop ? "dashboard-sidebar" : "mobile-navigation-drawer"}
                title={isDesktop ? (sidebarCollapsed ? "Expandir menú lateral" : "Contraer menú lateral") : undefined}
              >
                <AppIcon name="menu" className="h-5 w-5" />
              </button>

              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-100 sm:text-base">¡Hola, {profile.full_name?.split(" ")[0] || "Usuario"}! 👋</p>
                <p className="hidden text-xs text-slate-400 sm:block">Aquí tienes el resumen general del sistema.</p>
              </div>

              {/* USUARIO */}
              <div className="ml-auto flex items-center gap-3">
                <div className="hidden border-r border-white/10 pr-4 text-right md:block">
                  <p className="text-sm font-medium text-slate-200">{clock ? clock.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</p>
                  <p className="text-xs text-slate-400">{clock ? clock.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "—"}</p>
                </div>
                <div className="hidden text-right sm:block"><p className="max-w-36 truncate text-sm font-semibold text-slate-100">{profile.full_name || "Usuario"}</p><p className="text-xs capitalize text-slate-400">{profile.role}</p></div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-blue-400/25 bg-blue-500/20 text-sm font-bold text-blue-100">
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
            className="app-drawer-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm"
          />

          <aside id="mobile-navigation-drawer" className="app-drawer-panel relative flex h-dvh w-[85%] max-w-sm flex-col overflow-y-auto border-r border-white/10 bg-[#07101c] shadow-2xl">
            {/* CABECERA */}
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
              <Link
                href="/dashboard"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3"
              >
                <AppBrand />
              </Link>

              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="app-button-secondary h-10 w-10"
                aria-label="Cerrar menú"
              >
                <AppIcon name="close" className="h-5 w-5" />
              </button>
            </div>

            {/* LINKS */}
            <nav className="flex-1 px-4 py-6">
              <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
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
                      onClick={() => setMenuOpen(false)}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${
                        isActive
                          ? "border-blue-400/30 bg-blue-500/15 text-blue-200"
                          : "border-transparent text-slate-400 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5"><AppIcon name={item.icon} className="h-4 w-4" /></span>

                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </nav>

            {/* USUARIO */}
            <div className="border-t border-white/10 p-4">
              {logoutError && <p role="alert" className="text-sm text-red-700">{logoutError}</p>}
              <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.035] p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/20 font-bold text-blue-200">{profile.full_name?.charAt(0).toUpperCase() || "U"}</span>
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-100">{profile.full_name || "Usuario"}</p><p className="text-xs capitalize text-slate-400">{profile.role}</p></div>
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
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-200"
              >
                <AppIcon name="logout" className="h-4 w-4" />
                {loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div></DashboardDataProvider>
  );
}

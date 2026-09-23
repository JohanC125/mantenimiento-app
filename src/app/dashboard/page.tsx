"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useDashboardData } from "@/components/dashboard/DashboardDataProvider";
import { CreateOrderForm } from "@/components/orders/OrdersPages";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { AppIcon, type AppIconName } from "@/components/ui/AppIcon";

type Role = "administrador" | "planeador" | "auxiliar";

type Metrics = {
  pendingOrders: number;
  scheduledOrders: number;
  inProgressOrders: number;
  completedOrders: number;
  rescheduledOrders: number;
  cancelledOrders: number;
  activeUsers: number;
};

type RecentOrder = {
  id: string;
  order_number: string;
  description: string | null;
  aviso: string | null;
  status: string;
  scheduled_date: string | null;
  maintenance_type: string | null;
  site?: {
    name: string;
  } | null;
};

type DashboardSummary = { metrics: Metrics; recentOrders: RecentOrder[] };

const initialMetrics: Metrics = {
  pendingOrders: 0,
  scheduledOrders: 0,
  inProgressOrders: 0,
  completedOrders: 0,
  rescheduledOrders: 0,
  cancelledOrders: 0,
  activeUsers: 0,
};

const toneClass = {
  amber: "bg-amber-500/12 text-amber-200",
  blue: "bg-blue-500/12 text-blue-200",
  cyan: "bg-cyan-500/12 text-cyan-200",
  green: "bg-emerald-500/12 text-emerald-200",
  violet: "bg-violet-500/12 text-violet-200",
  red: "bg-red-500/12 text-red-200",
} as const;

function formatDate(date: string | null) {
  if (!date) return "Sin fecha";

  const parsedDate = new Date(`${date}T00:00:00`);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return parsedDate.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getRoleLabel(role: Role | null) {
  switch (role) {
    case "administrador":
      return "Administrador";
    case "auxiliar":
      return "Auxiliar / Coordinador";
    case "planeador":
      return "Planeador";
    default:
      return "Usuario";
  }
}

export default function DashboardPage() {
  const router = useRouter();
  const { profile, read, fetch } = useDashboardData();
  const [orderSearch, setOrderSearch] = useState("");
  const cached = read<DashboardSummary>("dashboard:summary");
  const [hasInitialCache] = useState(Boolean(cached));
  const [loading, setLoading] = useState(!cached);
  const [loadingOrders, setLoadingOrders] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<Metrics>(
    cached?.data.metrics ?? initialMetrics,
  );
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>(
    cached?.data.recentOrders ?? [],
  );

  const loadDashboard = useCallback(async () => {
    if (!hasInitialCache) setLoading(true);
    setError(null);

    try {
      const summary = await fetch("dashboard:summary", async () => {
        const ordersForUser = () => {
          const query = supabase
            .from("maintenance_orders")
            .select("id", { count: "exact", head: true })
            .is("deleted_at", null);
          return query;
        };
        const statusRequests = Promise.all([
          ordersForUser().eq("status", "pendiente"),
          ordersForUser().eq("status", "programada"),
          ordersForUser().eq("status", "en_ejecucion"),
          ordersForUser().eq("status", "completada"),
          ordersForUser().eq("status", "reprogramada"),
          ordersForUser().eq("status", "cancelada"),
        ]);
        const usersRequest =
          profile.role === "administrador"
            ? supabase
                .from("profiles")
                .select("id", { count: "exact", head: true })
                .eq("active", true)
            : Promise.resolve({ count: 0, error: null });
        const recentRequest = supabase
          .from("maintenance_orders")
          .select(
            `id, order_number, aviso, description, status, scheduled_date, maintenance_type, site:sites (name)`,
          )
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(6);
        const [
          pendingResult,
          scheduledResult,
          inProgressResult,
          completedResult,
          rescheduledResult,
          cancelledResult,
        ] = await statusRequests;

        const results = [
          pendingResult,
          scheduledResult,
          inProgressResult,
          completedResult,
          rescheduledResult,
          cancelledResult,
        ];

        const failedResult = results.find((result) => result.error);

        if (failedResult?.error) {
          throw failedResult.error;
        }

        const [
          { count: activeUsers, error: usersError },
          { data: orders, error: ordersError },
        ] = await Promise.all([usersRequest, recentRequest]);
        if (usersError) throw usersError;
        if (ordersError) throw ordersError;
        return {
          metrics: {
            pendingOrders: pendingResult.count ?? 0,
            scheduledOrders: scheduledResult.count ?? 0,
            inProgressOrders: inProgressResult.count ?? 0,
            completedOrders: completedResult.count ?? 0,
            rescheduledOrders: rescheduledResult.count ?? 0,
            cancelledOrders: cancelledResult.count ?? 0,
            activeUsers: activeUsers ?? 0,
          },
          recentOrders: ((orders ?? []) as unknown as RecentOrder[]).map(
            (order) => ({
              ...order,
              site: Array.isArray(order.site)
                ? (order.site[0] ?? null)
                : order.site,
            }),
          ),
        };
      });
      setMetrics(summary.metrics);
      setRecentOrders(summary.recentOrders);
    } catch (err) {
      console.error("Error cargando dashboard:", err);

      setError(
        err instanceof Error
          ? err.message
          : "No fue posible cargar el dashboard.",
      );
    } finally {
      setLoading(false);
      setLoadingOrders(false);
    }
  }, [fetch, hasInitialCache, profile.role]);

  useEffect(() => {
    // Async data bootstrap: pending state is paired with the network request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboard();
  }, [loadDashboard]);

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-80px)] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-blue-400" />
          <p className="text-sm text-slate-400">
            Cargando información del sistema...
          </p>
        </div>
      </div>
    );
  }

  if (error && !hasInitialCache) {
    return (
      <div className="p-6">
        <div className="app-card border-red-400/20 p-5">
          <h2 className="font-semibold text-red-200">
            No fue posible cargar el dashboard
          </h2>

          <p className="mt-2 text-sm text-red-300">{error}</p>

          <button
            onClick={loadDashboard}
            className="app-button-danger mt-4 px-4 py-2 text-sm"
          >
            Intentar nuevamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="app-page min-h-[calc(100vh-80px)] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-7">
        <section className="app-hero relative overflow-hidden rounded-3xl p-6 sm:p-8 lg:p-10">
          <div aria-hidden className="app-grid-pattern pointer-events-none absolute inset-0 opacity-70" />
          <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl"><p className="mb-3 text-xs font-bold uppercase tracking-[.22em] text-blue-300">Panel de control · {getRoleLabel(profile.role)}</p><h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Órdenes de Mantenimiento</h1><p className="mt-3 text-sm leading-6 text-slate-300 sm:text-base">Controla, programa y da seguimiento a todas tus órdenes en un solo lugar.</p></div>
            <div className="flex shrink-0 flex-wrap items-center gap-3"><CreateOrderForm enabled={profile.role === "planeador" || profile.role === "administrador"} /><button onClick={loadDashboard} className="app-button-secondary min-h-11 px-4 text-sm"><AppIcon name="refresh" className="h-4 w-4" /> Actualizar</button></div>
          </div>
          <div aria-hidden className="pointer-events-none absolute -right-14 -top-16 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />
        </section>

        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const query = orderSearch.trim();
            if (query) router.push(`/dashboard/ordenes/todas?search=${encodeURIComponent(query)}`);
          }}
          className="app-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5"
        >
          <AppIcon name="search" className="hidden h-5 w-5 shrink-0 text-blue-300 sm:block" />
          <label htmlFor="dashboard-order-search" className="sr-only">Buscar órdenes por OT o AVISO</label>
          <input
            id="dashboard-order-search"
            type="search"
            value={orderSearch}
            onChange={(event) => setOrderSearch(event.target.value)}
            placeholder="Buscar por OT o AVISO..."
            className="app-field min-w-0 flex-1 px-4 py-2 sm:border-0 sm:bg-transparent sm:shadow-none"
          />
          <button type="submit" disabled={!orderSearch.trim()} className="app-button-primary min-h-11 px-5 text-sm">Buscar</button>
        </form>

        {/* Resumen de órdenes */}
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-50">
                Resumen operativo
              </h2>
              <p className="text-sm text-slate-400">
                Estado actual de las órdenes de mantenimiento.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              title="Pendientes"
              value={metrics.pendingOrders}
              description="Esperando validación y aprobación"
              icon="document"
              tone="amber"
              href="/dashboard/ordenes/pendientes"
            />

            <MetricCard
              title="Programadas"
              value={metrics.scheduledOrders}
              description="Aprobadas por Auxiliar/Admin"
              icon="calendar"
              tone="blue"
              href="/dashboard/ordenes/programadas"
            />

            <MetricCard
              title="En ejecución"
              value={metrics.inProgressOrders}
              description="Trabajos activos"
              icon="activity"
              tone="cyan"
              href="/dashboard/ordenes/en-ejecucion"
            />

            <MetricCard
              title="Completadas"
              value={metrics.completedOrders}
              description="Órdenes finalizadas"
              icon="check"
              tone="green"
              href="/dashboard/ordenes/completadas"
            />
            <MetricCard title="Reprogramadas" value={metrics.rescheduledOrders} description="Cambios de programación" icon="refresh" tone="violet" href="/dashboard/ordenes/reprogramadas" />
            <MetricCard title="Canceladas" value={metrics.cancelledOrders} description="Órdenes canceladas" icon="ban" tone="red" href="/dashboard/ordenes/canceladas" />
          </div>
        </section>

        {/* Situaciones especiales */}
        {profile.role === "administrador" && <section className="app-card-soft flex items-center gap-4 p-4 sm:max-w-sm"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300"><AppIcon name="users" className="h-5 w-5" /></span><div><p className="text-xs text-slate-400">Usuarios activos</p><p className="text-xl font-bold text-slate-50">{metrics.activeUsers}</p></div></section>}
        {profile.role === "administrador" && (
          <Link
            href="/dashboard/ordenes/eliminadas"
            className="inline-block text-sm font-medium text-slate-500 hover:text-blue-700"
          >
            Ver órdenes eliminadas →
          </Link>
        )}

        <section className="app-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-5 sm:px-6"><div><h2 className="text-lg font-semibold text-slate-50">Órdenes recientes</h2><p className="mt-1 text-sm text-slate-400">Últimas órdenes registradas en el sistema.</p></div><Link href="/dashboard/ordenes/todas" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-300 hover:text-blue-200">Ver todas <AppIcon name="arrow" className="h-4 w-4" /></Link></div>
          {loadingOrders ? <div className="p-6 text-sm text-slate-400">Cargando órdenes…</div> : recentOrders.length === 0 ? (
            <div className="p-10 text-center"><AppIcon name="document" className="mx-auto h-10 w-10 text-blue-300/70" /><h3 className="mt-3 font-semibold text-slate-100">No hay órdenes registradas</h3><p className="mt-1 text-sm text-slate-400">Cuando se creen órdenes aparecerán aquí.</p></div>
          ) : <>
            <div className="hidden overflow-x-auto md:block"><table className="app-table min-w-[720px] text-left text-sm"><thead className="text-xs uppercase tracking-wide"><tr><th className="px-5 py-3">OT</th><th className="px-4 py-3">AVISO</th><th className="px-4 py-3">Sede</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Fecha</th></tr></thead><tbody>{recentOrders.map(order => <tr key={order.id}><td className="px-5 py-4 font-semibold"><Link href={`/dashboard/ordenes/${order.id}`} className="text-blue-300 hover:underline">OT-{String(order.order_number).padStart(6,"0")}</Link></td><td className="max-w-64 truncate px-4 py-4 text-slate-200" title={order.aviso || "Sin aviso"}>{order.aviso || "Sin aviso"}</td><td className="px-4 py-4 text-slate-300">{order.site?.name || "Sin sede"}</td><td className="px-4 py-4 capitalize text-slate-300">{order.maintenance_type || "—"}</td><td className="px-4 py-4"><StatusBadge status={order.status} /></td><td className="px-4 py-4 text-slate-400">{formatDate(order.scheduled_date)}</td></tr>)}</tbody></table></div>
            <div className="divide-y divide-white/10 md:hidden">{recentOrders.map(order => <Link key={order.id} href={`/dashboard/ordenes/${order.id}`} className="block px-5 py-4 transition hover:bg-white/5"><div className="flex items-center justify-between gap-2"><span className="font-semibold text-blue-300">OT-{String(order.order_number).padStart(6,"0")}</span><StatusBadge status={order.status} /></div><p className="mt-2 truncate text-sm font-medium text-slate-100">{order.aviso || "Sin aviso"}</p><p className="mt-1 text-xs text-slate-400">{order.site?.name || "Sin sede"} · {formatDate(order.scheduled_date)}</p></Link>)}</div>
          </>}
        </section>
      </div>
    </main>
  );
}

function MetricCard({
  title,
  value,
  description,
  icon,
  tone,
  href,
}: {
  title: string;
  value: number;
  description: string;
  icon: AppIconName;
  tone: "amber" | "blue" | "cyan" | "green" | "violet" | "red";
  href: string;
}) {
  return (
    <Link
      href={href}
      className="app-card app-hover-card group block min-w-0 cursor-pointer p-4 sm:p-5"
    >
      <div className="flex h-full flex-col justify-between gap-5">
        <div>
          <span className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${toneClass[tone]}`}><AppIcon name={icon} className="h-5 w-5" /></span>
          <p className="text-xs font-medium text-slate-400 sm:text-sm">{title}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-slate-50">{value}</p>
          <p className="mt-1 hidden text-xs text-slate-500 sm:block">{description}</p>
        </div>
      </div>
    </Link>
  );
}

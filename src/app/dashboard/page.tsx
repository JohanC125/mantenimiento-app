"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useDashboardData } from "@/components/dashboard/DashboardDataProvider";
import { CreateOrderForm } from "@/components/orders/OrdersPages";

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

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  programada: "Programada",
  en_ejecucion: "En ejecución",
  completada: "Completada",
  reprogramada: "Reprogramada",
  cancelada: "Cancelada",
};

const statusStyles: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800",
  programada: "bg-blue-100 text-blue-800",
  en_ejecucion: "bg-orange-100 text-orange-800",
  completada: "bg-green-100 text-green-800",
  reprogramada: "bg-purple-100 text-purple-800",
  cancelada: "bg-red-100 text-red-800",
};

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
  const { profile, read, fetch } = useDashboardData();
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
            `id, order_number, description, status, scheduled_date, maintenance_type, site:sites (name)`,
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
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
          <p className="text-sm text-gray-500">
            Cargando información del sistema...
          </p>
        </div>
      </div>
    );
  }

  if (error && !hasInitialCache) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <h2 className="font-semibold text-red-800">
            No fue posible cargar el dashboard
          </h2>

          <p className="mt-2 text-sm text-red-700">{error}</p>

          <button
            onClick={loadDashboard}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Intentar nuevamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-[calc(100vh-80px)] bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Bienvenida */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-blue-600">
                Sistema de Gestión de Mantenimiento
              </p>

              <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">
                Bienvenido, {profile.full_name || "Usuario"}
              </h1>

              <p className="mt-2 text-sm text-gray-500">
                {getRoleLabel(profile.role)}
              </p>
            </div>

            <button
              onClick={loadDashboard}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Actualizar
            </button>
          </div>
        </section>

        {/* Resumen de órdenes */}
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Resumen de órdenes
              </h2>
              <p className="text-sm text-gray-500">
                Estado actual de las órdenes de mantenimiento.
              </p>
            </div>
            <CreateOrderForm
              enabled={
                profile.role === "planeador" || profile.role === "administrador"
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Pendientes"
              value={metrics.pendingOrders}
              description="Esperando validación y aprobación"
              icon="📋"
              href="/dashboard/ordenes/pendientes"
            />

            <MetricCard
              title="Programadas"
              value={metrics.scheduledOrders}
              description="Aprobadas por Auxiliar/Admin"
              icon="📅"
              href="/dashboard/ordenes/programadas"
            />

            <MetricCard
              title="En ejecución"
              value={metrics.inProgressOrders}
              description="Trabajos activos"
              icon="🔧"
              href="/dashboard/ordenes/en-ejecucion"
            />

            <MetricCard
              title="Completadas"
              value={metrics.completedOrders}
              description="Órdenes finalizadas"
              icon="✅"
              href="/dashboard/ordenes/completadas"
            />
          </div>
        </section>

        {/* Situaciones especiales */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatusCard
            title="Reprogramadas"
            value={metrics.rescheduledOrders}
            description="Órdenes que cambiaron de programación"
            icon="🔄"
            href="/dashboard/ordenes/reprogramadas"
          />

          <StatusCard
            title="Canceladas"
            value={metrics.cancelledOrders}
            description="Órdenes canceladas"
            icon="🚫"
            href="/dashboard/ordenes/canceladas"
          />

          {profile.role === "administrador" ? (
            <StatusCard
              title="Usuarios activos"
              value={metrics.activeUsers}
              description="Usuarios habilitados en el sistema"
              icon="👥"
            />
          ) : null}
        </section>
        {profile.role === "administrador" && (
          <Link
            href="/dashboard/ordenes/eliminadas"
            className="inline-block text-sm font-medium text-slate-500 hover:text-blue-700"
          >
            Ver órdenes eliminadas →
          </Link>
        )}

        {/* Órdenes recientes */}
        <section className="rounded-2xl bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-gray-100 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Órdenes recientes
              </h2>

              <p className="text-sm text-gray-500">
                Últimas órdenes registradas en el sistema.
              </p>
            </div>

            <Link
              href="/dashboard/ordenes/todas"
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Ver todas →
            </Link>
          </div>

          {loadingOrders ? (
            <div className="p-6 text-sm text-gray-500">Cargando órdenes...</div>
          ) : recentOrders.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-4xl">📋</div>

              <h3 className="mt-3 font-medium text-gray-900">
                No hay órdenes registradas
              </h3>

              <p className="mt-1 text-sm text-gray-500">
                Cuando se creen órdenes aparecerán aquí.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex flex-col gap-3 p-5 transition hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900">
                        OT #{order.order_number}
                      </span>

                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          statusStyles[order.status] ??
                          "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {statusLabels[order.status] ?? order.status}
                      </span>
                    </div>

                    <p className="mt-1 truncate text-sm text-gray-600">
                      {order.description || "Sin descripción"}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>🏢 {order.site?.name || "Sin sede"}</span>

                      <span>📅 {formatDate(order.scheduled_date)}</span>

                      {order.maintenance_type && (
                        <span>🔧 {order.maintenance_type}</span>
                      )}
                    </div>
                  </div>

                  <Link
                    href={`/dashboard/ordenes/${order.id}`}
                    className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Ver órdenes
                  </Link>
                </div>
              ))}
            </div>
          )}
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
  href,
}: {
  title: string;
  value: number;
  description: string;
  icon: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group block cursor-pointer rounded-2xl bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:ring-2 hover:ring-blue-100 hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>

          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>

          <p className="mt-1 text-xs text-gray-500">{description}</p>
        </div>

        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100 text-xl transition group-hover:bg-blue-50">
          {icon}
        </div>
      </div>
    </Link>
  );
}

function StatusCard({
  title,
  value,
  description,
  icon,
  href,
}: {
  title: string;
  value: number;
  description: string;
  icon: string;
  href?: string;
}) {
  const content = (
    <>
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-xl">
          {icon}
        </div>

        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-500">{title}</p>

          <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>

          <p className="mt-1 text-xs leading-5 text-gray-500">{description}</p>
        </div>
      </div>
    </>
  );
  if (href)
    return (
      <Link
        href={href}
        className="block cursor-pointer rounded-2xl bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:ring-2 hover:ring-blue-100 hover:shadow-md"
      >
        {content}
      </Link>
    );
  return <div className="rounded-2xl bg-white p-5 shadow-sm">{content}</div>;
}

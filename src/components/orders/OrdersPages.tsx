"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { StatusBadge } from "@/components/orders/StatusBadge";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DependencyList,
} from "react";
import { errorMessage, logSupabaseError } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { useDashboardData } from "@/components/dashboard/DashboardDataProvider";
import { Modal } from "@/components/ui/Modal";
import { TimeField } from "@/components/ui/TimeField";
import { executeAction } from "@/lib/action-result";

type Role = "administrador" | "planeador" | "auxiliar";
type CheckType = "seguridad_social" | "sst" | "coass" | "copropiedad" | "coach";
type CheckStatus = "pendiente" | "cumple" | "no_cumple";

type Site = { id: number; name: string; active: boolean };
type Order = {
  id: number;
  order_number: number;
  site_id: number;
  maintenance_type: "preventivo" | "correctivo";
  description: string;
  scheduled_date: string;
  scheduled_time: string | null;
  status:
    | "pendiente"
    | "programada"
    | "en_ejecucion"
    | "completada"
    | "reprogramada"
    | "cancelada";
  approval_status: "pendiente" | "aprobada" | null;
  requires_coproperty: boolean;
  parent_order_id: number | null;
  root_order_id: number | null;
  reprogramming_number: number;
  reprogramming_reason: string | null;
  deleted_at: string | null;
  sites?: { name: string } | null;
  creator?: { full_name: string | null; role: Role } | null;
};
type Check = {
  id: number;
  order_id: number;
  check_type: CheckType;
  status: CheckStatus;
  observation: string | null;
  validated_at: string | null;
};

export const buckets = {
  todas: { title: "Todas las órdenes activas", status: null },
  pendientes: { title: "Órdenes pendientes", status: "pendiente" },
  programadas: { title: "Órdenes programadas", status: "programada" },
  "en-ejecucion": { title: "Órdenes en ejecución", status: "en_ejecucion" },
  completadas: { title: "Órdenes completadas", status: "completada" },
  reprogramadas: { title: "Órdenes reprogramadas", status: "reprogramada" },
  canceladas: { title: "Órdenes canceladas", status: "cancelada" },
  eliminadas: { title: "Órdenes eliminadas", status: null },
} as const;
export type BucketSlug = keyof typeof buckets;

const labels: Record<string, string> = {
  seguridad_social: "Seguridad Social",
  sst: "SST",
  coass: "COASS",
  copropiedad: "Copropiedad",
  pendiente: "Pendiente",
  cumple: "Cumple",
  no_cumple: "No cumple",
};
const orderPath = (id: number) => `/dashboard/ordenes/${id}`;
const formatNumber = (number: number) =>
  `OT-${String(number).padStart(6, "0")}`;
const formatDate = (date: string) =>
  date ? date.split("-").reverse().join("/") : "-";

const orderSelect =
  "*, sites(name, requires_coproperty), creator:profiles!maintenance_orders_created_by_fkey(full_name, role)";

function useCachedQuery<T>(
  key: string,
  loader: () => Promise<T>,
  dependencies: DependencyList,
) {
  const { read, fetch, version, revision } = useDashboardData();
  const cached = read<T>(key);
  const [state, setState] = useState<{
    key: string;
    data?: T;
    loading: boolean;
    error: string;
  }>({ key, data: cached?.data, loading: !cached, error: "" });
  const current =
    state.key === key
      ? state
      : { key, data: cached?.data, loading: !cached, error: "" };
  useEffect(() => {
    let active = true;
    const requestVersion = version(key);
    void fetch(key, loader)
      .then((result) => {
        if (!active) return;
        if (version(key) === requestVersion) {
          setState({ key, data: result, loading: false, error: "" });
        } else {
          setState((previous) => ({
            key,
            data: previous.key === key ? previous.data : cached?.data,
            loading: false,
            error: "",
          }));
        }
      })
      .catch((err) => {
        if (!active) return;
        logSupabaseError(`Carga ${key}`, err);
        setState((previous) => ({
          key,
          data: previous.key === key ? previous.data : cached?.data,
          loading: false,
          error: errorMessage(err),
        }));
      });
    return () => {
      active = false;
    };
    // The query key defines the cache lifecycle; a cached response is rendered before revalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  return {
    data: read<T>(key)?.data ?? current.data,
    loading: current.loading,
    error: current.error,
    revision,
  };
}

function useBucketOrders(slug: BucketSlug) {
  const config = buckets[slug];
  return useCachedQuery<Order[]>(
    `orders:bucket:${slug}`,
    async () => {
      let query = supabase
        .from("maintenance_orders")
        .select(orderSelect)
        .order("id", { ascending: false });
      query =
        slug === "eliminadas"
          ? query.not("deleted_at", "is", null)
          : slug === "todas"
            ? query.is("deleted_at", null)
            : query.eq("status", config.status!).is("deleted_at", null);
      const result = await query;
      if (result.error) throw result.error;
      return (result.data || []) as unknown as Order[];
    },
    [slug],
  );
}

function useOrder(id: number) {
  return useCachedQuery<Order>(
    `orders:detail:${id}`,
    async () => {
      const result = await supabase
        .from("maintenance_orders")
        .select(orderSelect)
        .eq("id", id)
        .single();
      if (result.error) throw result.error;
      return result.data as unknown as Order;
    },
    [id],
  );
}

function Status({ status }: { status: Order["status"] }) {
  return <StatusBadge status={status} />;
}

function OrderTable({ orders, from }: { orders: Order[]; from?: string }) {
  if (!orders.length)
    return (
      <p className="rounded-xl border bg-white p-6 text-sm text-slate-500">
        No hay órdenes en esta bandeja.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="min-w-[760px] w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="p-3">OT</th>
            <th className="p-3">Sede</th>
            <th className="p-3">Tipo</th>
            <th className="p-3">Fecha / hora</th>
            <th className="p-3">Creador</th>
            <th className="p-3">Estado</th>
            <th className="p-3" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {orders.map((order) => (
            <tr key={order.id} className="hover:bg-slate-50">
              <td className="p-3 font-semibold">
                {formatNumber(order.order_number)}
              </td>
              <td className="p-3 capitalize">{order.sites?.name || "-"}</td>
              <td className="p-3 capitalize">{order.maintenance_type}</td>
              <td className="p-3">
                {formatDate(order.scheduled_date)}
                {order.scheduled_time
                  ? ` · ${order.scheduled_time.slice(0, 5)}`
                  : ""}
              </td>
              <td className="p-3">{order.creator?.full_name || "-"}</td>
              <td className="p-3">
                <Status status={order.status} />
              </td>
              <td className="p-3">
                <Link
                  className="font-semibold text-blue-700 hover:underline"
                  href={`${orderPath(order.id)}${from ? `?from=${from}` : ""}`}
                >
                  Ver orden
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CreateOrderForm({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const { read, fetch, changeOrder, invalidate } = useDashboardData();
  const [open, setOpen] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    siteId: "",
    type: "preventivo",
    description: "",
    date: "",
    time: "",
  });
  useEffect(() => {
    if (!enabled || !open) return;
    void fetch("sites:active", async () => {
      const result = await supabase
        .from("sites")
        .select("id,name,active")
        .eq("active", true)
        .order("name");
      if (result.error) throw result.error;
      return (result.data || []) as Site[];
    })
      .then(setSites)
      .catch((err) => {
        logSupabaseError("Carga de sedes", err);
        setError(errorMessage(err));
      });
  }, [enabled, open, fetch, read]);
  if (!enabled) return null;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const nextErrors = {
      siteId: form.siteId ? "" : "La sede es obligatoria.",
      date: form.date ? "" : "La fecha es obligatoria.",
      time: /^\d{2}:\d{2}$/.test(form.time) ? "" : "La hora es obligatoria.",
      description: form.description.trim()
        ? ""
        : "La descripción es obligatoria.",
    };
    if (Object.values(nextErrors).some(Boolean)) {
      setFieldErrors(nextErrors);
      return;
    }
    setSaving(true);
    setError("");
    const result = await executeAction(() =>
      supabase.rpc("create_maintenance_order_v2", {
        p_site_id: Number(form.siteId),
        p_maintenance_type: form.type,
        p_description: form.description.trim(),
        p_scheduled_date: form.date,
        p_scheduled_time: form.time,
      }),
    );
    if (!result.ok) {
      logSupabaseError("Creación de orden", result.error);
      setError(errorMessage(result.error));
      setSaving(false);
      return;
    }
    try {
      const lookup = await supabase
        .from("maintenance_orders")
        .select(orderSelect)
        .eq("order_number", Number(result.data))
        .single();
      if (lookup.error) throw lookup.error;
      changeOrder(null, lookup.data as unknown as Order);
      setOpen(false);
      router.push(orderPath(Number(lookup.data.id)));
    } catch (err) {
      logSupabaseError("Sincronización posterior a creación", err);
      invalidate("orders:bucket:pendientes");
      invalidate("orders:bucket:todas");
      invalidate("orders:counts");
      invalidate("dashboard:summary");
      setError(
        "La orden fue creada, pero no pudo abrirse automáticamente. Revísala en Pendientes antes de intentar crear otra.",
      );
    } finally {
      setSaving(false);
    }
  };
  const availableSites = sites.length
    ? sites
    : read<Site[]>("sites:active")?.data || [];
  return (
    <>
      <button
        onClick={() => {
          setError("");
          setFieldErrors({});
          setOpen(true);
        }}
        className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
      >
        + Nueva orden
      </button>
      {open && (
        <Modal
          title="Nueva orden de mantenimiento"
          description="Completa la información para crear una nueva orden."
          onClose={() => !saving && setOpen(false)}
        >
          <form
            onSubmit={submit}
            noValidate
            className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6"
          >
            <label className="grid gap-1 text-sm font-medium">
              Sede *
              <select
                value={form.siteId}
                onChange={(event) =>
                  setForm({ ...form, siteId: event.target.value })
                }
                className="min-h-11 rounded-lg border bg-white px-3 py-2"
              >
                <option value="">Selecciona sede</option>
                {availableSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
              {fieldErrors.siteId && (
                <span className="text-xs text-red-700">
                  {fieldErrors.siteId}
                </span>
              )}
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Tipo *
              <select
                value={form.type}
                onChange={(event) =>
                  setForm({ ...form, type: event.target.value })
                }
                className="min-h-11 rounded-lg border bg-white px-3 py-2"
              >
                <option value="preventivo">Preventivo</option>
                <option value="correctivo">Correctivo</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Fecha *
              <input
                type="date"
                value={form.date}
                onChange={(event) =>
                  setForm({ ...form, date: event.target.value })
                }
                className="min-h-11 rounded-lg border px-3 py-2"
              />
              {fieldErrors.date && (
                <span className="text-xs text-red-700">{fieldErrors.date}</span>
              )}
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Hora *
              <TimeField
                id="create-time"
                value={form.time}
                onChange={(time) => setForm({ ...form, time })}
              />
              {fieldErrors.time && (
                <span className="text-xs text-red-700">{fieldErrors.time}</span>
              )}
            </label>
            <label className="grid gap-1 text-sm font-medium sm:col-span-2">
              Descripción *
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                placeholder="Describe el trabajo a realizar..."
                className="min-h-28 rounded-lg border p-3"
              />
              {fieldErrors.description && (
                <span className="text-xs text-red-700">
                  {fieldErrors.description}
                </span>
              )}
            </label>
            <p className="text-xs text-slate-500 sm:col-span-2">
              Una vez creada, la orden quedará pendiente de validación
              documental.
            </p>
            {error && (
              <p className="text-sm text-red-700 md:col-span-2">{error}</p>
            )}
            <div className="flex justify-end gap-3 sm:col-span-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setOpen(false)}
                className="min-h-11 rounded-lg border px-4 py-2 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                disabled={saving}
                className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Creando…" : "Crear orden"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function OrdersOverview() {
  const { profile } = useDashboardData();
  const {
    data: counts,
    loading,
    error,
  } = useCachedQuery<Record<string, number>>(
    "orders:counts",
    async () => {
      const requests = Object.entries(buckets).map(async ([slug, config]) => {
        let query = supabase
          .from("maintenance_orders")
          .select("id", { count: "exact", head: true });
        query =
          slug === "eliminadas"
            ? query.not("deleted_at", "is", null)
            : slug === "todas"
              ? query.is("deleted_at", null)
              : query.eq("status", config.status!).is("deleted_at", null);
        const result = await query;
        if (result.error) throw result.error;
        return [slug, result.count || 0] as const;
      });
      return Object.fromEntries(await Promise.all(requests));
    },
    [],
  );
  const cards = useMemo(
    () =>
      Object.entries(buckets)
        .filter(
          ([slug]) =>
            slug !== "todas" &&
            (slug !== "eliminadas" || profile.role === "administrador"),
        )
        .map(([slug, config]) => ({
          slug: slug as BucketSlug,
          ...config,
          count: counts?.[slug] ?? 0,
        })),
    [counts, profile],
  );
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div>
        <Link
          href="/dashboard"
          className="text-sm font-semibold text-slate-600 hover:text-blue-700"
        >
          ← Dashboard
        </Link>
        <h1 className="mt-3 text-2xl font-bold">Órdenes de mantenimiento</h1>
        <p className="text-sm text-slate-500">
          Selecciona una bandeja para ver sus órdenes.
        </p>
      </div>
      <CreateOrderForm
        enabled={
          profile?.role === "planeador" || profile?.role === "administrador"
        }
      />
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.slug}
            href={`/dashboard/ordenes/${card.slug}`}
            className="rounded-2xl border bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow"
          >
            <p className="text-sm text-slate-500">{card.title}</p>
            <p className="mt-2 text-3xl font-bold">
              {loading ? "…" : card.count}
            </p>
            <p className="mt-3 text-sm font-semibold text-blue-700">
              Abrir bandeja →
            </p>
          </Link>
        ))}
      </section>
    </main>
  );
}

export function OrdersBucket({ slug }: { slug: BucketSlug }) {
  const { profile } = useDashboardData();
  const { data: orders, loading, error } = useBucketOrders(slug);
  const [search, setSearch] = useState("");
  const config = buckets[slug];
  const visible = useMemo(
    () =>
      (orders || []).filter((order) =>
        `${order.order_number} ${order.description} ${order.sites?.name || ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [orders, search],
  );
  if (slug === "eliminadas" && profile.role !== "administrador")
    return (
      <main className="p-6">
        <Link href="/dashboard">← Volver al inicio</Link>
        <p className="mt-6">No tienes permiso para ver órdenes eliminadas.</p>
      </main>
    );
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <Link
        href="/dashboard"
        className="text-sm font-semibold text-slate-600 hover:text-blue-700"
      >
        ← Volver al inicio
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{config.title}</h1>
        <p className="text-sm text-slate-500">
          {loading ? "Cargando…" : `${visible.length} orden(es)`}
        </p>
      </div>
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Buscar por OT, sede o descripción"
        className="w-full rounded-xl border px-4 py-3"
      />
      {error ? (
        <p className="text-red-700">{error}</p>
      ) : loading && !orders ? (
        <div className="h-48 animate-pulse rounded-xl border bg-slate-100" />
      ) : (
        <OrderTable orders={visible} from={slug} />
      )}
    </main>
  );
}

export function OrderDetail({ id }: { id: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, changeOrder, invalidate } = useDashboardData();
  const { data: order, loading, error } = useOrder(id);
  const { data: history = [] } = useCachedQuery<Order[]>(
    `orders:history:${id}`,
    async () => {
      const current = await supabase
        .from("maintenance_orders")
        .select("root_order_id")
        .eq("id", id)
        .single();
      if (current.error) throw current.error;
      const rootId = current.data.root_order_id || id;
      const result = await supabase
        .from("maintenance_orders")
        .select(orderSelect)
        .or(`id.eq.${rootId},root_order_id.eq.${rootId}`)
        .order("id", { ascending: true });
      if (result.error) throw result.error;
      return (result.data || []) as unknown as Order[];
    },
    [id],
  );
  const [checks, setChecks] = useState<Check[]>([]);
  const [checksLoading, setChecksLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingCheckId, setUpdatingCheckId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reprogramOpen, setReprogramOpen] = useState(false);
  const [reprogramForm, setReprogramForm] = useState({
    date: "",
    time: "",
    reason: "",
  });
  const [reprogramErrors, setReprogramErrors] = useState<
    Record<string, string>
  >({});
  const loadChecks = useCallback(async () => {
    setChecksLoading(true);
    try {
      const result = await supabase
        .from("order_document_checks")
        .select("id,order_id,check_type,status,observation,validated_at")
        .eq("order_id", id)
        .order("id");
      if (result.error) throw result.error;
      setChecks((result.data || []) as Check[]);
    } catch (err) {
      logSupabaseError("Carga de validaciones", err);
      setActionError(errorMessage(err));
    } finally {
      setChecksLoading(false);
    }
  }, [id]);
  useEffect(() => {
    // The detail owns its request state and reloads when the route order changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadChecks();
  }, [loadChecks]);
  const returnToOriginIfNeeded = (nextOrder: Order) => {
    const origin = searchParams.get("from");
    if (!origin || !(origin in buckets)) return;
    const slug = origin as BucketSlug;
    const config = buckets[slug];
    const stillBelongs =
      slug === "todas"
        ? !nextOrder.deleted_at
        : slug === "eliminadas"
          ? Boolean(nextOrder.deleted_at)
          : !nextOrder.deleted_at && nextOrder.status === config.status;
    if (!stillBelongs) router.replace(`/dashboard/ordenes/${slug}`);
  };
  const run = async ({ context, successMessage, request, patch }: {
    context: string;
    successMessage: string;
    request: () => PromiseLike<{ data: unknown; error: unknown }>;
    patch: Partial<Order>;
  }): Promise<boolean> => {
    if (saving || !order) return false;
    setSaving(true);
    setActionError("");
    setMessage("");
    const result = await executeAction(request);
    if (!result.ok) {
      logSupabaseError(context, result.error);
      setActionError(errorMessage(result.error));
      setSaving(false);
      return false;
    }
    try {
      changeOrder(order, { ...order, ...patch });
      setMessage(successMessage);
    } catch (syncError) {
      logSupabaseError(`Sincronización posterior a ${context}`, syncError);
      invalidate("orders:counts");
      invalidate("dashboard:summary");
      setMessage(
        `${successMessage} La vista local no pudo actualizarse por completo; recarga para confirmar los datos.`,
      );
    } finally {
      setSaving(false);
    }
    returnToOriginIfNeeded({ ...order, ...patch });
    return true;
  };
  const canValidate =
    profile.role === "auxiliar" || profile.role === "administrador";
  const canManage =
    profile.role === "planeador" || profile.role === "administrador";
  const applicable = checks.filter(
    (check) =>
      check.check_type !== "coach" &&
      (check.check_type !== "copropiedad" || order?.requires_coproperty),
  );
  const updateCheck = async (check: Check, status: CheckStatus) => {
    if (updatingCheckId !== null) return;
    const observation = check.observation || "";
    const previous = check;
    const next = { ...check, status, observation: observation.trim() || null };
    setChecks((current) =>
      current.map((item) => (item.id === check.id ? next : item)),
    );
    setUpdatingCheckId(check.id);
    setActionError("");
    const result = await executeAction(() =>
      supabase.rpc("validate_order_document_check", {
        p_order_id: check.order_id,
        p_check_type: check.check_type,
        p_status: status,
        p_observation: observation.trim() || null,
      }),
    );
    if (!result.ok) {
      setChecks((current) =>
        current.map((item) => (item.id === check.id ? previous : item)),
      );
      logSupabaseError("Actualización de validación", result.error);
      setActionError(errorMessage(result.error));
    }
    setUpdatingCheckId(null);
  };
  const reprogram = async () => {
    const errors = {
      date: reprogramForm.date ? "" : "La fecha es obligatoria.",
      time: /^\d{2}:\d{2}$/.test(reprogramForm.time)
        ? ""
        : "La hora es obligatoria.",
      reason: reprogramForm.reason.trim() ? "" : "El motivo es obligatorio.",
    };
    if (Object.values(errors).some(Boolean)) {
      setReprogramErrors(errors);
      return;
    }
    if (saving || !order) return;
    setSaving(true);
    setActionError("");
    setMessage("");
    const result = await executeAction(() =>
      supabase.rpc("reprogram_maintenance_order_v2", {
        p_parent_order_id: id,
        p_new_scheduled_date: reprogramForm.date,
        p_new_scheduled_time: reprogramForm.time,
        p_reason: reprogramForm.reason.trim(),
      }),
    );
    if (!result.ok) {
      logSupabaseError("Reprogramación de orden", result.error);
      setActionError(errorMessage(result.error));
      setSaving(false);
      return;
    }
    try {
      changeOrder(order, { ...order, status: "reprogramada" });
      const child = await supabase
        .from("maintenance_orders")
        .select(orderSelect)
        .eq("order_number", Number(result.data))
        .single();
      if (child.error) throw child.error;
      changeOrder(null, child.data as unknown as Order);
      setMessage("Orden reprogramada correctamente.");
    } catch (syncError) {
      logSupabaseError(
        "Sincronización posterior a reprogramación",
        syncError,
      );
      invalidate("orders:bucket:pendientes");
      invalidate("orders:bucket:todas");
      invalidate("orders:counts");
      invalidate("dashboard:summary");
      setMessage(
        "Orden reprogramada correctamente. La nueva OT no pudo sincronizarse en la vista; recarga Pendientes para verla.",
      );
    }
    setReprogramOpen(false);
    setSaving(false);
    returnToOriginIfNeeded({ ...order, status: "reprogramada" });
  };
  const deleteOrder = async () => {
    if (saving || !order) return;
    setSaving(true);
    setActionError("");
    const result = await executeAction(() => supabase.rpc("delete_maintenance_order_v2", {
        p_order_id: id,
        p_reason: "Eliminada por administrador desde la interfaz.",
      }));
    if (result.ok) {
      try {
        changeOrder(order, { ...order, deleted_at: new Date().toISOString() });
      } catch (syncError) {
        logSupabaseError(
          "Sincronización posterior a eliminación",
          syncError,
        );
        invalidate("orders:counts");
        invalidate("dashboard:summary");
      }
      setDeleteOpen(false);
      router.replace("/dashboard/ordenes/eliminadas");
    } else {
      logSupabaseError("Eliminación de orden", result.error);
      setActionError(errorMessage(result.error));
    }
    setSaving(false);
  };
  if (loading)
    return (
      <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
        <div className="h-28 animate-pulse rounded-2xl bg-slate-100" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </main>
    );
  if (error || !order)
    return (
      <main className="p-6">
        <button onClick={() => router.back()} className="font-semibold">
          ← Volver
        </button>
        <p className="mt-6 text-red-700">
          {error || "La orden no está disponible."}
        </p>
      </main>
    );
  const canApprove =
    canValidate &&
    order.status === "pendiente" &&
    order.approval_status === "pendiente";
  const canStart =
    canManage &&
    order.status === "programada" &&
    order.approval_status === "aprobada";
  const canComplete =
    canManage &&
    order.status === "en_ejecucion" &&
    order.approval_status === "aprobada";
  const canReprogram =
    canManage &&
    ["pendiente", "programada", "en_ejecucion"].includes(order.status);
  const from = searchParams.get("from");
  const returnHref =
    from && from in buckets ? `/dashboard/ordenes/${from}` : "/dashboard";
  const returnLabel =
    from && from in buckets
      ? `Volver a ${buckets[from as BucketSlug].title.replace("Órdenes ", "")}`
      : "Volver al inicio";
  const requiredChecks = order.requires_coproperty ? 4 : 3;
  const completeChecks = applicable.filter(
    (check) => check.status === "cumple",
  ).length;
  const missingChecks = Math.max(0, requiredChecks - completeChecks);
  const nextStep =
    order.status === "pendiente"
      ? "Esta orden está esperando la validación de la documentación."
      : order.status === "programada"
        ? "Documentación aprobada. La orden está lista para iniciar gestión."
        : order.status === "en_ejecucion"
          ? "La orden se encuentra actualmente en ejecución."
          : order.status === "completada"
            ? "Esta orden fue completada."
            : "Esta orden no tiene acciones operativas disponibles.";
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <Link
        href={returnHref}
        className="text-sm font-semibold text-slate-600 hover:text-blue-700"
      >
        ← {returnLabel}
      </Link>
      {message && (
        <p className="rounded-xl border border-green-200 bg-green-50 p-3 text-green-700">
          {message}
        </p>
      )}
      {actionError && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
          {actionError}
        </p>
      )}
      <header className="border-b pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">
              {formatNumber(order.order_number)}
            </h1>
            <p className="mt-1 capitalize text-slate-600">
              Mantenimiento {order.maintenance_type} · Sede:{" "}
              {order.sites?.name || "-"}
            </p>
          </div>
          <Status status={order.status} />
        </div>
      </header>
      <section className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="rounded-2xl border bg-white p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Información de la orden
          </h2>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="text-slate-500">Sede</dt>
              <dd className="mt-1 font-semibold capitalize">
                {order.sites?.name || "-"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Tipo</dt>
              <dd className="mt-1 font-semibold capitalize">
                {order.maintenance_type}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Fecha</dt>
              <dd className="mt-1 font-semibold">
                {formatDate(order.scheduled_date)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Hora</dt>
              <dd className="mt-1 font-semibold">
                {order.scheduled_time?.slice(0, 5) || "-"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Creada por</dt>
              <dd className="mt-1 font-semibold">
                {order.creator?.full_name || "-"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Aprobación</dt>
              <dd className="mt-1 font-semibold">
                {order.approval_status === "aprobada"
                  ? "Aprobada"
                  : "Pendiente"}
              </dd>
            </div>
          </dl>
          <div className="mt-5 border-t pt-4">
            <p className="text-sm font-semibold">Descripción</p>
            <p className="mt-1 text-sm text-slate-600">{order.description}</p>
          </div>
        </div>
        <aside className="rounded-2xl border bg-white p-5">
          <h2 className="font-bold">Estado de la orden</h2>
          <div className="mt-3">
            <Status status={order.status} />
          </div>
          <p className="mt-3 text-sm text-slate-600">{nextStep}</p>
          {canApprove && (
            <>
              <p className="mt-3 text-sm text-slate-600">
                {missingChecks
                  ? `Faltan ${missingChecks} de ${requiredChecks} validaciones por cumplir.`
                  : "Todos los documentos están en Cumple."}
              </p>
              <button
                disabled={saving || missingChecks > 0}
                onClick={() =>
                  void run({
                    context: "Aprobación de orden",
                    successMessage: "Orden aprobada correctamente.",
                    request: () => supabase.rpc("approve_maintenance_order", {
                      p_order_id: id,
                    }),
                    patch: { status: "programada", approval_status: "aprobada" },
                  })
                }
                className="mt-4 rounded-lg bg-green-600 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Aprobar orden
              </button>
              {missingChecks > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  Todos los documentos deben estar en Cumple para aprobar la
                  orden.
                </p>
              )}
            </>
          )}
          {canStart && (
            <button
              disabled={saving}
              onClick={() =>
                void run({ context: "Inicio de gestión", successMessage: "Gestión iniciada correctamente.", request: () => supabase.rpc("start_maintenance_order", { p_order_id: id }), patch: { status: "en_ejecucion" } })
              }
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              Iniciar gestión
            </button>
          )}
          {canComplete && (
            <button
              disabled={saving}
              onClick={() =>
                void run({
                  context: "Finalización de orden",
                  successMessage: "Orden completada correctamente.",
                  request: () => supabase.rpc("complete_maintenance_order", {
                    p_order_id: id,
                  }),
                  patch: { status: "completada" },
                })
              }
              className="mt-4 rounded-lg bg-green-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              Completar orden
            </button>
          )}
          {canReprogram && (
            <button
              disabled={saving}
              onClick={() => {
                setReprogramErrors({});
                setReprogramOpen(true);
              }}
              className="mt-4 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 font-semibold text-purple-700 disabled:opacity-50"
            >
              Reprogramar
            </button>
          )}
          {profile.role === "administrador" && !order.deleted_at && (
            <button
              disabled={saving}
              onClick={() => setDeleteOpen(true)}
              className="mt-6 block rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Eliminar orden
            </button>
          )}
        </aside>
      </section>
      {reprogramOpen && (
        <Modal
          title="Reprogramar orden"
          description={`${formatNumber(order.order_number)} · Selecciona la nueva programación.`}
          onClose={() => !saving && setReprogramOpen(false)}
        >
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void reprogram();
            }}
            className="grid gap-4 p-5 sm:p-6"
          >
            <label className="grid gap-1 text-sm font-medium">
              Fecha *
              <input
                type="date"
                value={reprogramForm.date}
                onChange={(event) =>
                  setReprogramForm({
                    ...reprogramForm,
                    date: event.target.value,
                  })
                }
                className="min-h-11 rounded-lg border px-3 py-2"
              />
              {reprogramErrors.date && (
                <span className="text-xs text-red-700">
                  {reprogramErrors.date}
                </span>
              )}
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Hora *
              <TimeField
                id="reprogram-time"
                value={reprogramForm.time}
                onChange={(time) =>
                  setReprogramForm({ ...reprogramForm, time })
                }
              />
              {reprogramErrors.time && (
                <span className="text-xs text-red-700">
                  {reprogramErrors.time}
                </span>
              )}
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Motivo de reprogramación *
              <textarea
                value={reprogramForm.reason}
                onChange={(event) =>
                  setReprogramForm({
                    ...reprogramForm,
                    reason: event.target.value,
                  })
                }
                placeholder="Ej: Ajuste de agenda, disponibilidad"
                className="min-h-28 rounded-lg border p-3"
              />
              {reprogramErrors.reason && (
                <span className="text-xs text-red-700">
                  {reprogramErrors.reason}
                </span>
              )}
            </label>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => setReprogramOpen(false)}
                className="min-h-11 rounded-lg border px-4 py-2 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                disabled={saving}
                className="min-h-11 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Reprogramando…" : "Reprogramar"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleteOpen && (
        <Modal
          title={`¿Eliminar ${formatNumber(order.order_number)}?`}
          description="La orden dejará de aparecer en las bandejas activas, pero permanecerá en el registro de eliminadas."
          onClose={() => !saving && setDeleteOpen(false)}
        >
          <div className="flex justify-end gap-3 p-5 sm:p-6">
            <button
              type="button"
              disabled={saving}
              onClick={() => setDeleteOpen(false)}
              className="min-h-11 rounded-lg border px-4 py-2"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void deleteOrder()}
              className="min-h-11 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Eliminando…" : "Eliminar orden"}
            </button>
          </div>
        </Modal>
      )}
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-bold">Documentación</h2>
        {checksLoading ? (
          <p className="mt-4">Cargando…</p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {applicable.map((check) => (
              <article key={check.id} className="rounded-xl border p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{labels[check.check_type]}</h3>
                  <StatusBadge status={check.status} kind="document" />
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  {check.observation
                    ? `Observación: ${check.observation}`
                    : "Sin observaciones"}
                </p>
                {canValidate && !order.deleted_at && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      disabled={saving || updatingCheckId !== null}
                      onClick={() => updateCheck(check, "cumple")}
                      className="rounded border px-3 py-1 text-sm text-green-700"
                    >
                      Cumple
                    </button>
                    <button
                      disabled={saving || updatingCheckId !== null}
                      onClick={() => updateCheck(check, "no_cumple")}
                      className="rounded border px-3 py-1 text-sm text-red-700"
                    >
                      No cumple
                    </button>
                    <button
                      disabled={saving || updatingCheckId !== null}
                      onClick={() => updateCheck(check, "pendiente")}
                      className="rounded border px-3 py-1 text-sm"
                    >
                      Pendiente
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-bold">Historial de reprogramaciones</h2>
        {history.length > 1 ? (
          <div className="mt-4">
            <OrderTable orders={history} from={from || undefined} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            Esta orden no tiene reprogramaciones.
          </p>
        )}
      </section>
    </main>
  );
}

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
import { AppIcon } from "@/components/ui/AppIcon";
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
  aviso: string | null;
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
  aviso_match?: boolean;
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
const orderDetailPath = (id: number, from?: string, search?: string) => {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (search) params.set("search", search);
  const query = params.toString();
  return `${orderPath(id)}${query ? `?${query}` : ""}`;
};
const formatNumber = (number: number) =>
  `OT-${String(number).padStart(6, "0")}`;
const formatDate = (date: string) =>
  date ? date.split("-").reverse().join("/") : "-";
const normalizeAviso = (subject: string) => `AVISO ${subject.trim().replace(/\s+/g, " ")}`;
const validAviso = (subject: string) => /[\p{L}\p{N}]/u.test(subject);
function BackLink({ href }: { href: string }) {
  return (
    <Link href={href} className="app-button-secondary min-h-10 w-fit max-w-full cursor-pointer gap-2 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">
      <AppIcon name="arrow" className="h-4 w-4 rotate-180" aria-hidden="true" />
      Volver
    </Link>
  );
}
const emptyCreateOrderForm = {
  siteId: "",
  type: "preventivo",
  avisoSubject: "",
  description: "",
  date: "",
  time: "",
};

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

function useBucketOrders(slug: BucketSlug, limit: number) {
  const config = buckets[slug];
  return useCachedQuery<Order[]>(
    `orders:bucket:${slug}`,
    async () => {
      let query = supabase
        .from("maintenance_orders")
        .select(orderSelect)
        .order("id", { ascending: false })
        .limit(limit);
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
    [slug, limit],
  );
}

type SearchBundle = { orders: Order[]; familyOrders: Order[] };
function useSearchOrders(slug: BucketSlug, term: string) {
  const { version } = useDashboardData();
  const key = `orders:search:${slug}:${term.toLocaleLowerCase("es-CO")}`;
  return useCachedQuery<SearchBundle>(
    key,
    async () => {
      if (!term) return { orders: [], familyOrders: [] };
      const matches = await supabase.rpc("search_maintenance_orders_v2", {
        p_query: term.trim(),
        p_bucket: slug,
      });
      if (matches.error) throw matches.error;
      const refs = (matches.data || []) as { order_id: number; aviso_match: boolean }[];
      const matchById = new Map(refs.map((item) => [Number(item.order_id), item.aviso_match]));
      const rows: Order[] = [];
      for (let offset = 0; offset < refs.length; offset += 200) {
        const ids = refs.slice(offset, offset + 200).map((item) => item.order_id);
        const result = await supabase.from("maintenance_orders")
          .select(orderSelect).in("id", ids);
        if (result.error) throw result.error;
        rows.push(...((result.data || []) as unknown as Order[]));
      }
      const orders = rows.map((order) => ({
        ...order,
        aviso_match: matchById.get(order.id) || false,
      })).sort((a, b) => b.id - a.id);
      const rootIds = [...new Set(orders.filter((order) => order.aviso_match)
        .map((order) => order.root_order_id || order.id))];
      const familyById = new Map<number, Order>();
      for (let offset = 0; offset < rootIds.length; offset += 100) {
        const ids = rootIds.slice(offset, offset + 100);
        const [roots, descendants] = await Promise.all([
          supabase.from("maintenance_orders").select(orderSelect).in("id", ids),
          supabase.from("maintenance_orders").select(orderSelect).in("root_order_id", ids),
        ]);
        if (roots.error) throw roots.error;
        if (descendants.error) throw descendants.error;
        for (const member of [...(roots.data || []), ...(descendants.data || [])] as unknown as Order[]) {
          familyById.set(member.id, member);
        }
      }
      return { orders, familyOrders: [...familyById.values()] };
    },
    [slug, term, version(key)],
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

function OrderTable({ orders, from, search }: { orders: Order[]; from?: string; search?: string }) {
  if (!orders.length)
    return (
      <p className="app-card p-8 text-center text-sm text-slate-500">
        No hay órdenes en esta bandeja.
      </p>
    );
  return (
    <div className="app-card overflow-x-auto">
      <table className="app-table min-w-[760px] text-left text-sm">
        <thead className="text-xs uppercase tracking-[.12em]">
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
            <tr key={order.id}>
              <td className="p-3 font-semibold text-blue-200">
                {formatNumber(order.order_number)}
                <span className="mt-0.5 block max-w-64 truncate text-xs font-normal text-slate-500" title={order.aviso || "Sin aviso"}>
                  {order.aviso || "Sin aviso"}
                </span>
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
                  className="font-semibold text-blue-300 transition hover:text-blue-200 hover:underline"
                  href={orderDetailPath(order.id, from, search)}
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

function currentFamilyOrder(members: Order[]) {
  const parentIds = new Set(members.map((item) => item.parent_order_id).filter((id): id is number => id !== null));
  return [...members].filter((item) => !parentIds.has(item.id))
    .sort((a, b) => b.reprogramming_number - a.reprogramming_number || b.id - a.id)[0] || null;
}

function OrderChainRow({ order, currentId, from, search, selected = false, inBucket = true }: {
  order: Order;
  currentId: number | null;
  from?: string;
  search?: string;
  selected?: boolean;
  inBucket?: boolean;
}) {
  return (
    <div className={`relative flex flex-wrap items-center justify-between gap-3 border-l border-blue-400/20 py-4 pl-7 pr-4 text-sm before:absolute before:-left-[6px] before:top-6 before:h-3 before:w-3 before:rounded-full before:border-2 before:border-blue-300 before:bg-[#0d1928] ${selected ? "bg-blue-500/7" : ""}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-100">{formatNumber(order.order_number)}</p>
          <span className="text-xs text-slate-400">{order.parent_order_id ? `Reprogramación ${order.reprogramming_number}` : "Orden original"}</span>
          {order.id === currentId && <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-200">Programación actual</span>}
          {selected && <span className="text-[11px] font-semibold text-blue-300">Estás aquí</span>}
        </div>
        <p className="mt-1 text-xs text-slate-400">{formatDate(order.scheduled_date)} · {order.scheduled_time?.slice(0, 5) || "Sin hora"} · {order.sites?.name || "Sede sin nombre"}</p>
        {!inBucket && <p className="mt-1 text-xs text-slate-500">Fuera de esta bandeja</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Status status={order.status} />
        <Link href={orderDetailPath(order.id, from, search)} aria-label={`Ver ${formatNumber(order.order_number)}`} className="font-semibold text-blue-300 hover:underline">Ver orden</Link>
      </div>
    </div>
  );
}

function OrderSearchResults({ bundle, from, search }: { bundle: SearchBundle; from: BucketSlug; search: string }) {
  const [expanded, setExpanded] = useState<number[]>([]);
  const groups = new Map<number, Order[]>();
  const standalone: Order[] = [];
  for (const order of bundle.orders) {
    if (!order.aviso_match) {
      standalone.push(order);
      continue;
    }
    const rootId = order.root_order_id || order.id;
    groups.set(rootId, [...(groups.get(rootId) || []), order]);
  }
  const matchedIds = new Set(bundle.orders.map((item) => item.id));
  if (!bundle.orders.length) return <OrderTable orders={[]} from={from} />;
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([rootId, matched]) => {
        const family = bundle.familyOrders.filter((item) => (item.root_order_id || item.id) === rootId)
          .sort((a, b) => a.reprogramming_number - b.reprogramming_number || a.id - b.id);
        const members = family.length ? family : matched;
        const current = currentFamilyOrder(members);
        const [first, ...remaining] = members;
        const isExpanded = expanded.includes(rootId);
        return (
          <section key={rootId} className="app-card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-blue-400/15 bg-blue-500/8 px-4 py-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300"><AppIcon name="document" className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-blue-300">Cadena de reprogramaciones</p>
                <h2 className="mt-0.5 break-words font-semibold text-slate-100">{members[0]?.aviso || "Sin aviso"}</h2>
                {current && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <p className="text-xs text-slate-400">Programación actual: <span className="font-semibold text-slate-100">{formatNumber(current.order_number)}</span></p>
                    <Link
                      href={orderDetailPath(current.id, from, search)}
                      aria-label={`Ver programación actual ${formatNumber(current.order_number)}`}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-blue-400/25 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-200 transition-colors hover:border-blue-300/50 hover:bg-blue-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                    >
                      Ver actual <AppIcon name="arrow" className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                )}
              </div>
              <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-200">{members.length} OT</span>
            </div>
            <div className="px-5">{first && <OrderChainRow order={first} currentId={current?.id || null} from={from} search={search} inBucket={matchedIds.has(first.id)} />}</div>
            {remaining.length > 0 && <>
              <button type="button" aria-expanded={isExpanded} onClick={() => setExpanded((currentIds) => isExpanded ? currentIds.filter((id) => id !== rootId) : [...currentIds, rootId])} className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-3 text-left text-sm font-semibold text-blue-300 hover:bg-slate-50">
                <AppIcon name="chevron" className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} /> Ver reprogramaciones ({remaining.length})
              </button>
              {isExpanded && <div className="app-reveal divide-y divide-slate-100 border-t border-slate-100 bg-slate-950/25 px-5">{remaining.map((member) => <OrderChainRow key={member.id} order={member} currentId={current?.id || null} from={from} search={search} inBucket={matchedIds.has(member.id)} />)}</div>}
            </>}
          </section>
        );
      })}
      {standalone.length > 0 && <OrderTable orders={standalone} from={from} search={search} />}
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
  const [form, setForm] = useState(emptyCreateOrderForm);
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
      aviso: validAviso(form.avisoSubject)
        ? ""
        : "Ingresa el AVISO de la orden.",
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
        p_aviso: normalizeAviso(form.avisoSubject),
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
          setForm({ ...emptyCreateOrderForm });
          setOpen(true);
        }}
        className="app-button-primary min-h-11 px-4 py-2 text-sm"
      >
        <AppIcon name="plus" className="h-4 w-4" /> Nueva orden
      </button>
      {open && (
        <Modal
          title="Nueva orden de mantenimiento"
          description="Completa la información para crear una nueva orden."
          icon={<AppIcon name="document" className="h-5 w-5" />}
          closeDisabled={saving}
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
                className="app-field px-3 py-2"
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
                className="app-field px-3 py-2"
              >
                <option value="preventivo">Preventivo</option>
                <option value="correctivo">Correctivo</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              AVISO *
              <span className="app-field flex min-w-0 overflow-hidden">
                <span aria-hidden="true" className="pointer-events-none flex select-none items-center border-r border-white/10 bg-blue-500/10 px-3 text-sm font-bold tracking-wide text-blue-200">AVISO</span>
                <input
                  type="text"
                  aria-label="Contenido del AVISO"
                  value={form.avisoSubject}
                  onChange={(event) => setForm({ ...form, avisoSubject: event.target.value })}
                  className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 shadow-none outline-none focus:shadow-none"
                />
              </span>
              {fieldErrors.aviso && <span className="text-xs text-red-700">{fieldErrors.aviso}</span>}
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Fecha *
              <input
                type="date"
                value={form.date}
                onChange={(event) =>
                  setForm({ ...form, date: event.target.value })
                }
                className="app-field px-3 py-2"
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
                className="app-field min-h-28 p-3"
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
                className="app-button-secondary min-h-11 px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                disabled={saving}
                className="app-button-primary min-h-11 px-4 py-2 text-sm"
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
    <main className="app-page mx-auto max-w-7xl space-y-7 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
        <BackLink href="/dashboard" />
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Órdenes de mantenimiento</h1>
        <p className="mt-1 text-sm text-slate-500">
          Organiza el trabajo por estado y abre la bandeja que necesitas.
        </p>
        </div>
        <CreateOrderForm
          enabled={profile?.role === "planeador" || profile?.role === "administrador"}
        />
      </div>
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.slug}
            href={`/dashboard/ordenes/${card.slug}`}
            className="app-card app-hover-card group p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300"><AppIcon name="document" className="h-5 w-5" /></span>
              <AppIcon name="arrow" className="h-4 w-4 text-slate-500 transition group-hover:translate-x-1 group-hover:text-blue-300" />
            </div>
            <p className="mt-5 text-sm text-slate-400">{card.title}</p>
            <p className="mt-1 text-3xl font-bold tracking-tight">
              {loading ? "…" : card.count}
            </p>
            <p className="mt-5 text-sm font-semibold text-blue-300">
              Ver órdenes
            </p>
          </Link>
        ))}
      </section>
    </main>
  );
}

export function OrdersBucket({ slug }: { slug: BucketSlug }) {
  const { profile } = useDashboardData();
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("search") || "";
  const [limit, setLimit] = useState(100);
  const { data: orders, loading, error } = useBucketOrders(slug, limit);
  const [search, setSearch] = useState(initialSearch);
  const [searchTerm, setSearchTerm] = useState(initialSearch.trim());
  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchTerm(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const { data: searchResults, loading: searchLoading, error: searchError } = useSearchOrders(slug, searchTerm);
  const config = buckets[slug];
  const searching = Boolean(search.trim());
  const waitingForSearch = searching && (search.trim() !== searchTerm || searchLoading);
  if (slug === "eliminadas" && profile.role !== "administrador")
    return (
      <main className="p-6">
        <BackLink href="/dashboard" />
        <p className="mt-6">No tienes permiso para ver órdenes eliminadas.</p>
      </main>
    );
  return (
    <main className="app-page mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <BackLink href="/dashboard" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
        <p className="text-xs font-semibold uppercase tracking-[.15em] text-blue-300">Órdenes de mantenimiento</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{config.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {searching
            ? waitingForSearch ? "Buscando…" : `${searchResults?.orders.length || 0} orden(es) encontradas`
            : loading && !orders ? "Cargando…" : `Mostrando ${orders?.length || 0} orden(es)`}
        </p>
        </div>
      </div>
      <div className="app-field flex items-center gap-3 px-4">
        <AppIcon name="search" className="h-5 w-5 shrink-0 text-slate-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por OT, AVISO, sede o descripción"
          aria-label="Buscar órdenes por OT, AVISO, sede o descripción"
          className="min-h-11 w-full border-0 bg-transparent py-2 outline-none"
        />
      </div>
      {searching ? searchError ? (
        <p className="text-red-700">{searchError}</p>
      ) : waitingForSearch || !searchResults ? (
        <div className="app-card h-48 animate-pulse" />
      ) : (
        <OrderSearchResults key={`${slug}:${searchTerm}`} bundle={searchResults} from={slug} search={searchTerm} />
      ) : error ? (
        <p className="text-red-700">{error}</p>
      ) : loading && !orders ? (
        <div className="app-card h-48 animate-pulse" />
      ) : (
        <>
          <OrderTable orders={orders || []} from={slug} />
          {(orders?.length || 0) >= limit && (
            <button type="button" disabled={loading} onClick={() => setLimit((current) => current + 100)} className="app-button-secondary min-h-11 px-4 py-2 text-sm">
              {loading ? "Cargando…" : "Cargar más órdenes"}
            </button>
          )}
        </>
      )}
    </main>
  );
}

export function OrderDetail({ id }: { id: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const searchOrigin = searchParams.get("search")?.trim() || "";
  const validFrom = from && from in buckets ? from : undefined;
  const returnHref = validFrom
    ? `/dashboard/ordenes/${validFrom}${searchOrigin ? `?search=${encodeURIComponent(searchOrigin)}` : ""}`
    : "/dashboard";
  const { profile, changeOrder, invalidate } = useDashboardData();
  const { data: order, loading, error } = useOrder(id);
  const { data: history = [], loading: historyLoading, error: historyError } = useCachedQuery<Order[]>(
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
    if (!stillBelongs) router.replace(returnHref);
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
        <div className="h-5 w-32 animate-pulse rounded bg-[#233a55]" />
        <div className="app-card h-28 animate-pulse" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="app-card h-48 animate-pulse" />
          <div className="app-card h-48 animate-pulse" />
        </div>
      </main>
    );
  if (error || !order)
    return (
      <main className="p-6">
        <BackLink href={returnHref} />
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
    !order.deleted_at &&
    order.status === "programada" &&
    order.approval_status === "aprobada";
  const canComplete =
    canManage &&
    order.status === "en_ejecucion" &&
    order.approval_status === "aprobada";
  const canReprogram =
    canManage &&
    !order.deleted_at &&
    ["pendiente", "programada", "en_ejecucion"].includes(order.status) &&
    Boolean(order.aviso);
  const rootOrder = history.find((item) => item.id === order.root_order_id);
  const previousOrder = history.find((item) => item.id === order.parent_order_id);
  const childOrder = history.find((item) => item.parent_order_id === order.id);
  const currentOrder = currentFamilyOrder(history);
  const requiredChecks = order.requires_coproperty ? 4 : 3;
  const completeChecks = applicable.filter(
    (check) => check.status === "cumple",
  ).length;
  const missingChecks = Math.max(0, requiredChecks - completeChecks);
  const nextStep =
    order.status === "pendiente"
      ? "Esta orden está esperando la validación de la documentación."
      : order.status === "programada"
        ? "Documentación aprobada. La orden está lista para iniciar el trabajo."
        : order.status === "en_ejecucion"
          ? "La orden se encuentra actualmente en ejecución."
          : order.status === "completada"
          ? "Esta orden fue completada."
            : order.status === "reprogramada"
              ? "Esta orden fue reprogramada. Consulta la programación actual en la nueva OT."
              : "Esta orden no tiene acciones operativas disponibles.";
  return (
    <main className="app-page mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <BackLink href={returnHref} />
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
      <header className="app-hero relative overflow-hidden rounded-2xl p-5 sm:p-7">
        <div className="app-grid-pattern pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-blue-300">Aviso de mantenimiento</p>
        <p className="mt-2 max-w-3xl break-words text-xl font-bold tracking-tight sm:text-2xl">{order.aviso || "Sin aviso"}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="mt-3 text-sm font-semibold text-blue-200">
              {formatNumber(order.order_number)}
            </h1>
            <p className="mt-1 text-sm capitalize text-slate-300">
              Mantenimiento {order.maintenance_type} · Sede:{" "}
              {order.sites?.name || "-"}
            </p>
          </div>
          <Status status={order.status} />
        </div>
        {order.parent_order_id && <p className="mt-4 text-xs text-slate-300">Reprogramación {order.reprogramming_number} de la familia iniciada en {rootOrder ? formatNumber(rootOrder.order_number) : "la orden original"}</p>}
        </div>
      </header>
      {(childOrder || order.status === "reprogramada") && (
        <section className="app-card border-violet-400/20 p-5 sm:p-6" aria-label="Orden reprogramada">
          <div className="flex flex-wrap items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-200"><AppIcon name="refresh" className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">Esta orden fue reprogramada</h2>
              {currentOrder && <p className="mt-1 text-sm text-slate-300">La programación actual continúa en <strong className="text-cyan-200">{formatNumber(currentOrder.order_number)}</strong>.</p>}
              {childOrder ? <>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <p><span className="block text-xs text-slate-500">Nueva orden</span><span className="font-semibold">{formatNumber(childOrder.order_number)}</span></p>
                  <p><span className="block text-xs text-slate-500">Estado</span><Status status={childOrder.status} /></p>
                  <p><span className="block text-xs text-slate-500">Fecha y hora</span>{formatDate(childOrder.scheduled_date)} · {childOrder.scheduled_time?.slice(0, 5) || "Sin hora"}</p>
                  <p><span className="block text-xs text-slate-500">Sede</span>{childOrder.sites?.name || "Sede sin nombre"}</p>
                  <p className="min-w-0 sm:col-span-2"><span className="block text-xs text-slate-500">AVISO</span><span className="break-words">{childOrder.aviso || "Sin aviso"}</span></p>
                </div>
                <Link href={orderDetailPath((currentOrder || childOrder).id, validFrom, searchOrigin)} className="app-button-primary mt-5 min-h-10 px-4 py-2 text-sm">Ver orden actual <AppIcon name="arrow" className="h-4 w-4" /></Link>
              </> : <p className="mt-3 text-sm text-slate-400">{historyLoading ? "Cargando la nueva programación…" : historyError || "No se pudo identificar la nueva orden en el historial."}</p>}
            </div>
          </div>
        </section>
      )}
      {order.parent_order_id && (
        <section className="app-card-soft flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6" aria-label="Orden anterior">
          <div><h2 className="font-semibold">Esta orden proviene de una reprogramación</h2><p className="mt-1 text-sm text-slate-400">Orden anterior: {previousOrder ? formatNumber(previousOrder.order_number) : historyLoading ? "Cargando…" : "No disponible"}</p></div>
          {previousOrder && <Link href={orderDetailPath(previousOrder.id, validFrom, searchOrigin)} className="app-button-secondary min-h-10 px-4 py-2 text-sm"><AppIcon name="arrow" className="h-4 w-4 rotate-180" /> Ver orden anterior</Link>}
        </section>
      )}
      <section className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="app-card p-5 sm:p-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Información general
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
        <aside className="app-card p-5 sm:p-6">
          <h2 className="font-bold">Estado y acciones</h2>
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
                className="app-button-primary mt-4 min-h-11 px-4 py-2 text-sm"
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
              className="app-button-primary mt-4 min-h-11 px-4 py-2 text-sm"
            >
              Iniciar orden
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
              className="app-button-primary mt-4 min-h-11 px-4 py-2 text-sm"
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
              className="app-button-secondary mt-4 min-h-11 px-4 py-2 text-sm text-violet-200"
            >
              Reprogramar
            </button>
          )}
          {canManage && !order.deleted_at && !order.aviso && ["pendiente", "programada", "en_ejecucion"].includes(order.status) && (
            <p className="mt-4 text-xs text-amber-700">Esta OT histórica no tiene AVISO; no puede generar una reprogramación nueva sin ese requisito.</p>
          )}
          {profile.role === "administrador" && !order.deleted_at && (
            <button
              disabled={saving}
              onClick={() => setDeleteOpen(true)}
              className="app-button-danger mt-6 min-h-11 px-4 py-2 text-sm"
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
          icon={<AppIcon name="calendar" className="h-5 w-5" />}
          closeDisabled={saving}
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
                className="app-field px-3 py-2"
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
                className="app-field min-h-28 p-3"
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
                className="app-button-secondary min-h-11 px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                disabled={saving}
                className="app-button-primary min-h-11 px-4 py-2 text-sm"
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
          icon={<AppIcon name="ban" className="h-5 w-5" />}
          closeDisabled={saving}
          onClose={() => !saving && setDeleteOpen(false)}
        >
          <div className="flex justify-end gap-3 p-5 sm:p-6">
            <button
              type="button"
              disabled={saving}
              onClick={() => setDeleteOpen(false)}
              className="app-button-secondary min-h-11 px-4 py-2"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void deleteOrder()}
              className="app-button-danger min-h-11 px-4 py-2"
            >
              {saving ? "Eliminando…" : "Eliminar orden"}
            </button>
          </div>
        </Modal>
      )}
      <section className="app-card p-5 sm:p-6">
        <h2 className="text-lg font-bold">Validación documental</h2>
        {checksLoading ? (
          <p className="mt-4">Cargando…</p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {applicable.map((check) => (
              <article key={check.id} className="app-card-soft p-4">
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
                      className="app-button-secondary min-h-10 px-3 py-1 text-sm text-green-300"
                    >
                      Cumple
                    </button>
                    <button
                      disabled={saving || updatingCheckId !== null}
                      onClick={() => updateCheck(check, "no_cumple")}
                      className="app-button-secondary min-h-10 px-3 py-1 text-sm text-red-300"
                    >
                      No cumple
                    </button>
                    <button
                      disabled={saving || updatingCheckId !== null}
                      onClick={() => updateCheck(check, "pendiente")}
                      className="app-button-secondary min-h-10 px-3 py-1 text-sm"
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
      <section className="app-card p-5 sm:p-6">
        <h2 className="text-lg font-bold">Historial de reprogramaciones</h2>
        {historyLoading && !history.length ? (
          <p className="mt-3 text-sm text-slate-400">Cargando historial…</p>
        ) : historyError ? (
          <p role="alert" className="mt-3 text-sm text-red-300">{historyError}</p>
        ) : history.length > 1 ? (
          <div className="mt-4 pl-3">
            {[...history].sort((a, b) => a.reprogramming_number - b.reprogramming_number || a.id - b.id)
              .map((member) => <OrderChainRow key={member.id} order={member} currentId={currentOrder?.id || null} from={validFrom} search={searchOrigin} selected={member.id === order.id} />)}
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

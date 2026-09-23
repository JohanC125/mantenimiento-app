export type CacheEntry<T> = { data: T; updatedAt: number };
export type OrderState = { id: number; status: "pendiente" | "programada" | "en_ejecucion" | "completada" | "reprogramada" | "cancelada"; deleted_at: string | null; root_order_id?: number | null };
export const statusBucket = { pendiente: "pendientes", programada: "programadas", en_ejecucion: "en-ejecucion", completada: "completadas", reprogramada: "reprogramadas", cancelada: "canceladas" } as const;
const metricKey = { pendiente: "pendingOrders", programada: "scheduledOrders", en_ejecucion: "inProgressOrders", completada: "completedOrders", reprogramada: "rescheduledOrders", cancelada: "cancelledOrders" } as const;

export class DashboardCache {
  entries = new Map<string, CacheEntry<unknown>>();
  private pending = new Map<string, Promise<unknown>>();
  private versions = new Map<string, number>();
  constructor(private publish: () => void) {}
  read = <T,>(key: string) => this.entries.get(key) as CacheEntry<T> | undefined;
  version = (key: string) => this.versions.get(key) || 0;
  private supersede(key: string) {
    this.versions.set(key, this.version(key) + 1);
    this.pending.delete(key);
  }
  write = <T,>(key: string, data: T) => {
    this.supersede(key);
    this.entries.set(key, { data, updatedAt: Date.now() });
    this.publish();
  };
  invalidate = (key: string) => {
    this.supersede(key);
    const entry = this.entries.get(key);
    if (entry) this.entries.set(key, { ...entry, updatedAt: 0 });
    this.publish();
  };
  fetch = <T,>(key: string, loader: () => Promise<T>): Promise<T> => {
    const existing = this.pending.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const version = this.version(key);
    const request = Promise.resolve().then(loader).then(data => {
      if (this.version(key) === version) {
        this.entries.set(key, { data, updatedAt: Date.now() });
        this.publish();
      }
      return data;
    }).finally(() => { if (this.pending.get(key) === request) this.pending.delete(key); });
    this.pending.set(key, request);
    return request;
  };
  changeOrder = <T extends OrderState>(before: T | null, after: T) => {
    // Touch only order resources; numeric site IDs must never be patched as OT IDs.
    for (const [key, entry] of this.entries) {
      if (key.startsWith("orders:search:")) {
        this.invalidate(key);
        continue;
      }
      if (!key.startsWith("orders:")) continue;
      if (key.startsWith("orders:bucket:")) {
        const slug = key.slice("orders:bucket:".length);
        const belongs = slug === "eliminadas" ? !!after.deleted_at : !after.deleted_at && (slug === "todas" || slug === statusBucket[after.status]);
        const rows = (entry.data as T[]).filter(row => row.id !== after.id);
        this.write(key, belongs ? [...rows, after].sort((a, b) => b.id - a.id) : rows);
      } else if (key.startsWith("orders:history:")) {
        const history = entry.data as T[];
        const afterRoot = after.root_order_id ?? after.id;
        const belongs = history.some(row => (row.root_order_id ?? row.id) === afterRoot);
        const existed = history.some(row => row.id === after.id);
        if (belongs || existed) {
          const rows = history.filter(row => row.id !== after.id);
          this.write(key, [...rows, after].sort((a, b) => a.id - b.id));
        }
      }
    }
    this.write(`orders:detail:${after.id}`, after);
    this.invalidate("orders:counts");
    const summary = this.read<{ metrics: Record<string, number>; recentOrders: Array<{ id: number | string; status: string }> }>("dashboard:summary");
    if (summary) {
      const metrics = { ...summary.data.metrics };
      if (before && !before.deleted_at) metrics[metricKey[before.status]] = Math.max(0, (metrics[metricKey[before.status]] ?? 0) - 1);
      if (!after.deleted_at) metrics[metricKey[after.status]] = (metrics[metricKey[after.status]] ?? 0) + 1;
      const recentOrders = summary.data.recentOrders.flatMap(row => Number(row.id) !== after.id ? [row] : after.deleted_at ? [] : [{ ...row, status: after.status }]);
      this.write("dashboard:summary", { ...summary.data, metrics, recentOrders });
    }
    this.invalidate("dashboard:summary");
  };
}

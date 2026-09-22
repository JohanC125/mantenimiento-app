const orderStyles: Record<string, string> = {
  pendiente: "border-amber-200 bg-amber-50 text-amber-800",
  programada: "border-blue-200 bg-blue-50 text-blue-800",
  en_ejecucion: "border-indigo-200 bg-indigo-50 text-indigo-800",
  completada: "border-emerald-200 bg-emerald-50 text-emerald-800",
  reprogramada: "border-orange-200 bg-orange-50 text-orange-800",
  cancelada: "border-red-200 bg-red-50 text-red-800",
};

const documentStyles: Record<string, string> = {
  pendiente: "border-amber-200 bg-amber-50 text-amber-800",
  cumple: "border-emerald-200 bg-emerald-50 text-emerald-800",
  no_cumple: "border-red-200 bg-red-50 text-red-800",
};

const labels: Record<string, string> = {
  pendiente: "Pendiente", programada: "Programada", en_ejecucion: "En ejecución",
  completada: "Completada", reprogramada: "Reprogramada", cancelada: "Cancelada",
  cumple: "Cumple", no_cumple: "No cumple",
};

export function StatusBadge({ status, kind = "order" }: { status: string; kind?: "order" | "document" }) {
  const styles = kind === "document" ? documentStyles : orderStyles;
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${styles[status] || "border-slate-200 bg-slate-50 text-slate-700"}`}>{labels[status] || status}</span>;
}

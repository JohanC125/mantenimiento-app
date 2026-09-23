const orderStyles: Record<string, string> = {
  pendiente: "border-amber-400/25 bg-amber-500/12 text-amber-200",
  programada: "border-blue-400/25 bg-blue-500/12 text-blue-200",
  en_ejecucion: "border-cyan-400/25 bg-cyan-500/12 text-cyan-200",
  completada: "border-emerald-400/25 bg-emerald-500/12 text-emerald-200",
  reprogramada: "border-violet-400/25 bg-violet-500/12 text-violet-200",
  cancelada: "border-red-400/25 bg-red-500/12 text-red-200",
};

const documentStyles: Record<string, string> = {
  pendiente: "border-amber-400/25 bg-amber-500/12 text-amber-200",
  cumple: "border-emerald-400/25 bg-emerald-500/12 text-emerald-200",
  no_cumple: "border-red-400/25 bg-red-500/12 text-red-200",
};

const labels: Record<string, string> = {
  pendiente: "Pendiente", programada: "Programada", en_ejecucion: "En ejecución",
  completada: "Completada", reprogramada: "Reprogramada", cancelada: "Cancelada",
  cumple: "Cumple", no_cumple: "No cumple",
};

export function StatusBadge({ status, kind = "order" }: { status: string; kind?: "order" | "document" }) {
  const styles = kind === "document" ? documentStyles : orderStyles;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors ${styles[status] || "border-white/10 bg-white/5 text-slate-300"}`}><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{labels[status] || status}</span>;
}

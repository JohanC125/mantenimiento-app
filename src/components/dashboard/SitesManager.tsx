"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/errors";
import { useDashboardData } from "./DashboardDataProvider";
import { AppIcon } from "@/components/ui/AppIcon";
type Site = { id: number; name: string; address: string | null; city: string | null; active: boolean; requires_coproperty: boolean };
const empty = { name: "", address: "", city: "", active: true, requires_coproperty: false };
export default function SitesManager() {
  const [sites, setSites] = useState<Site[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const { read, fetch: cacheFetch, invalidate } = useDashboardData();
  useEffect(() => {
    let current = true;
    async function load() {
      const cached = read<Site[]>("sites:all");
      if (cached) { setSites(cached.data); setLoading(false); } else setLoading(true);
      setError("");
      try {
        const data = await cacheFetch("sites:all", async () => {
          const result = await supabase.from("sites").select("id,name,address,city,active,requires_coproperty").order("name");
          if (result.error) throw result.error;
          return result.data || [];
        });
        if (current) setSites(data);
      } catch (err) { if (current) setError(errorMessage(err)); }
      finally { if (current) setLoading(false); }
    }
    void load(); return () => { current = false; };
  }, [cacheFetch, read, revision]);
  async function save() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/sites", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, id: editing }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      invalidate("sites:all"); invalidate("sites:active"); setOpen(false); setMessage("Sede guardada correctamente."); setRevision(x => x + 1);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  const visibleSites = sites.filter(s => `${s.name} ${s.city || ""} ${s.address || ""}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="app-page mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.15em] text-blue-300">Administración</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Sedes</h1><p className="mt-1 text-sm text-slate-500">Ubicaciones y disponibilidad operativa</p></div><button onClick={() => { setEditing(null); setForm(empty); setOpen(true); }} className="app-button-primary min-h-11 px-5 py-2 text-sm"><AppIcon name="plus" className="h-4 w-4" /> Nueva sede</button></div>
    {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-red-300">{error} <button className="underline" onClick={() => setRevision(x => x + 1)}>Reintentar</button></p>}
    {message && <p role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-emerald-300">{message}</p>}
    {open && <form onSubmit={e => { e.preventDefault(); void save(); }} className="app-card grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
      <div className="sm:col-span-2"><h2 className="text-lg font-semibold">{editing ? "Editar sede" : "Nueva sede"}</h2><p className="text-sm text-slate-500">Configura los datos y requisitos de la sede.</p></div>
      {(["name", "address", "city"] as const).map(key => <label key={key} className="grid gap-2 text-sm font-medium">{{ name: "Nombre", address: "Dirección", city: "Ciudad" }[key]}<input required={key === "name"} className="app-field p-3" value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}
      <label className="app-card-soft flex min-h-11 items-center gap-3 px-4 py-3 text-sm"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />Sede activa</label>
      <label className="app-card-soft flex min-h-11 items-center gap-3 px-4 py-3 text-sm sm:col-span-2"><input type="checkbox" checked={form.requires_coproperty} onChange={e => setForm({ ...form, requires_coproperty: e.target.checked })} />¿Requiere permiso de copropiedad?</label>
      <div className="flex flex-wrap gap-3 sm:col-span-2"><button disabled={busy} className="app-button-primary min-h-11 px-5 py-2 text-sm">{busy ? "Guardando…" : "Guardar sede"}</button><button type="button" disabled={busy} onClick={() => setOpen(false)} className="app-button-secondary min-h-11 px-5 py-2 text-sm">Cancelar</button></div>
    </form>}
    <div className="app-field flex items-center gap-3 px-4"><AppIcon name="search" className="h-5 w-5 text-slate-400" /><input aria-label="Buscar sedes" placeholder="Buscar nombre, ciudad o dirección" className="min-h-11 w-full border-0 bg-transparent py-2 outline-none" value={search} onChange={e => setSearch(e.target.value)} /></div>
    {loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map(item => <div key={item} className="app-card h-44 animate-pulse" />)}</div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleSites.map(site => <article key={site.id} className="app-card app-hover-card p-5"><div className="flex items-start justify-between gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300"><AppIcon name="site" className="h-5 w-5" /></span><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${site.active ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300" : "border-slate-400/20 bg-slate-500/10 text-slate-300"}`}>{site.active ? "Activa" : "Inactiva"}</span></div><h2 className="mt-4 font-semibold">{site.name}</h2><p className="mt-1 text-sm text-slate-500">{site.address || "Sin dirección"} · {site.city || "Sin ciudad"}</p><p className="mt-4 text-xs font-medium text-slate-400">{site.requires_coproperty ? "Requiere permiso de copropiedad" : "No requiere permiso de copropiedad"}</p><button className="app-button-secondary mt-5 min-h-10 px-4 py-2 text-sm" onClick={() => { setEditing(site.id); setForm({ ...site, address: site.address || "", city: site.city || "" }); setOpen(true); }}>Editar / cambiar estado</button></article>)}</div>}
    {!loading && !error && !visibleSites.length && <p className="app-card p-8 text-center text-sm text-slate-400">No hay sedes que coincidan con la búsqueda.</p>}
  </main>;
}

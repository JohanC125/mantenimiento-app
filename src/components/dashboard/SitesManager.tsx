"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/errors";
import { useDashboardData } from "./DashboardDataProvider";
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
  return <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-bold">Sedes</h1><p className="text-slate-500">Ubicaciones y disponibilidad operativa</p></div><button onClick={() => { setEditing(null); setForm(empty); setOpen(true); }} className="rounded-xl bg-blue-600 px-5 py-3 text-white">Nueva sede</button></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error} <button className="underline" onClick={() => setRevision(x => x + 1)}>Reintentar</button></p>}
    {message && <p role="status" className="rounded-xl bg-green-50 p-4 text-green-800">{message}</p>}
    {open && <form onSubmit={e => { e.preventDefault(); void save(); }} className="grid gap-4 rounded-2xl border bg-white p-5 sm:grid-cols-2">
      <h2 className="font-semibold sm:col-span-2">{editing ? "Editar sede" : "Nueva sede"}</h2>
      {(["name", "address", "city"] as const).map(key => <label key={key} className="grid gap-1 text-sm">{{ name: "Nombre", address: "Dirección", city: "Ciudad" }[key]}<input required={key === "name"} className="rounded-lg border p-3" value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}
      <label className="flex items-center gap-3"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />Sede activa</label>
      <label className="flex items-center gap-3 sm:col-span-2"><input type="checkbox" checked={form.requires_coproperty} onChange={e => setForm({ ...form, requires_coproperty: e.target.checked })} />¿Requiere permiso de copropiedad?</label>
      <div className="flex gap-3 sm:col-span-2"><button disabled={busy} className="rounded-lg bg-blue-600 px-5 py-3 text-white disabled:opacity-50">{busy ? "Guardando…" : "Guardar"}</button><button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-lg border px-5 py-3">Cancelar</button></div>
    </form>}
    <input aria-label="Buscar sedes" placeholder="Buscar nombre, ciudad o dirección" className="w-full rounded-xl border bg-white p-3" value={search} onChange={e => setSearch(e.target.value)} />
    {loading ? <p>Cargando sedes…</p> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{sites.filter(s => `${s.name} ${s.city || ""} ${s.address || ""}`.toLowerCase().includes(search.toLowerCase())).map(site => <article key={site.id} className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="font-semibold">{site.name}</h2><p className="text-sm text-slate-500">{site.address || "Sin dirección"} · {site.city || "Sin ciudad"}</p><p className={site.active ? "text-green-700" : "text-slate-500"}>{site.active ? "Activa" : "Inactiva"}</p><p className="text-sm font-medium text-slate-600">{site.requires_coproperty ? "Requiere permiso de copropiedad" : "No requiere permiso de copropiedad"}</p><button className="rounded-lg border px-4 py-2" onClick={() => { setEditing(site.id); setForm({ ...site, address: site.address || "", city: site.city || "" }); setOpen(true); }}>Editar / cambiar estado</button></article>)}</div>}
    {!loading && !error && !sites.length && <p>No hay sedes disponibles.</p>}
  </div>;
}

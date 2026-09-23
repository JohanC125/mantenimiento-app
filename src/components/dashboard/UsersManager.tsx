"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useDashboardData } from "@/components/dashboard/DashboardDataProvider";
import { executeAction } from "@/lib/action-result";
import { errorMessage, logSupabaseError } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { AppIcon } from "@/components/ui/AppIcon";

type Role = "administrador" | "planeador" | "auxiliar";
type UserProfile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  active: boolean;
  deleted_at: string | null;
  created_at: string;
};
type StateFilter = "vigentes" | "activos" | "inactivos" | "eliminados" | "todos";
type DeleteResult = { id: string; mode: "permanent" | "historical" };
type UserResult = { user: { id: string; active: boolean; deleted_at: string | null } };

async function userRequest<T>(method: "POST" | "PATCH" | "DELETE", body: object) {
  const response = await fetch("/api/admin/users", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  const remoteError = response.ok
    ? null
    : Object.assign(
        new Error(typeof payload.error === "string" ? payload.error : "No se pudo guardar el cambio."),
        { code: String(response.status) },
      );
  return { data: payload as T, error: remoteError };
}

function initials(name: string) {
  return name.trim().charAt(0).toLocaleUpperCase("es-CO") || "U";
}

function roleLabel(role: Role) {
  return { administrador: "Administrador", planeador: "Planeador", auxiliar: "Auxiliar" }[role];
}

function userState(user: UserProfile) {
  return user.deleted_at ? "Eliminado" : user.active ? "Activo" : "Inactivo";
}

function Avatar({ user }: { user: UserProfile }) {
  return (
    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-blue-400/25 bg-blue-500/15 text-sm font-bold text-blue-200">
      {initials(user.full_name)}
    </span>
  );
}

function StateBadge({ user }: { user: UserProfile }) {
  const tone = user.deleted_at
    ? "border-slate-400/20 bg-slate-500/10 text-slate-300"
    : user.active
      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300"
      : "border-amber-400/20 bg-amber-500/10 text-amber-300";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{userState(user)}</span>;
}

function UserActions({
  user,
  ownAccount,
  busy,
  onEdit,
  onDelete,
  onReactivate,
  onRestore,
}: {
  user: UserProfile;
  ownAccount: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onReactivate: () => void;
  onRestore: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  const act = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div ref={menuRef} className="relative inline-block text-left">
      <button
        type="button"
        aria-label={`Acciones para ${user.full_name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
      >
        {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" /> : "⋯"}
      </button>
      {open && (
        <div role="menu" className="app-modal-panel absolute right-0 top-full z-40 mt-1 w-48 rounded-xl p-1.5">
          {!user.deleted_at && (
            <button role="menuitem" type="button" onClick={() => act(onEdit)} className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
              Editar
            </button>
          )}
          {!ownAccount && !user.deleted_at && !user.active && (
            <button role="menuitem" type="button" onClick={() => act(onReactivate)} className="w-full rounded-lg px-3 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50">
              Reactivar usuario
            </button>
          )}
          {!ownAccount && user.deleted_at && (
            <button role="menuitem" type="button" onClick={() => act(onRestore)} className="w-full rounded-lg px-3 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50">
              Restaurar usuario
            </button>
          )}
          {!ownAccount && !user.deleted_at && (
            <button role="menuitem" type="button" onClick={() => act(onDelete)} className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50">
              Eliminar usuario
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function UsersManager() {
  const { profile, read, write, fetch: cacheFetch, invalidate } = useDashboardData();
  const cached = read<UserProfile[]>("users:all");
  const [users, setUsers] = useState<UserProfile[]>(cached?.data ?? []);
  const [loading, setLoading] = useState(!cached);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "todos">("todos");
  const [stateFilter, setStateFilter] = useState<StateFilter>("vigentes");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("auxiliar");
  const [savingForm, setSavingForm] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const actionInFlight = useRef(false);

  const loadUsers = useCallback(async () => {
    if (!read<UserProfile[]>("users:all")) setLoading(true);
    setLoadError("");
    try {
      const rows = await cacheFetch("users:all", async () => {
        const all: UserProfile[] = [];
        const pageSize = 500;
        for (let offset = 0; ; offset += pageSize) {
          const result = await supabase.from("profiles")
            .select("id,full_name,email,role,active,deleted_at,created_at")
            .order("created_at", { ascending: false })
            .range(offset, offset + pageSize - 1);
          if (result.error) throw result.error;
          all.push(...((result.data ?? []) as UserProfile[]));
          if (!result.data || result.data.length < pageSize) break;
        }
        return all;
      });
      setUsers(rows);
    } catch (error) {
      logSupabaseError("Carga de usuarios", error);
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [cacheFetch, read]);

  useEffect(() => {
    // Async bootstrap of the module's own cached data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUsers();
  }, [loadUsers]);

  const visibleUsers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-CO");
    return users.filter((user) => {
      const matchesSearch = `${user.full_name} ${user.email}`.toLocaleLowerCase("es-CO").includes(term);
      const matchesRole = roleFilter === "todos" || user.role === roleFilter;
      const matchesState = stateFilter === "todos"
        || (stateFilter === "vigentes" && !user.deleted_at)
        || (stateFilter === "activos" && !user.deleted_at && user.active)
        || (stateFilter === "inactivos" && !user.deleted_at && !user.active)
        || (stateFilter === "eliminados" && Boolean(user.deleted_at));
      return matchesSearch && matchesRole && matchesState;
    });
  }, [users, search, roleFilter, stateFilter]);

  const adjustActiveCount = (delta: number) => {
    const summary = read<{ metrics: { activeUsers: number }; recentOrders: unknown[] }>("dashboard:summary");
    if (summary) {
      write("dashboard:summary", {
        ...summary.data,
        metrics: {
          ...summary.data.metrics,
          activeUsers: Math.max(0, summary.data.metrics.activeUsers + delta),
        },
      });
    }
    invalidate("dashboard:summary");
  };

  const updateUserCache = (next: UserProfile[]) => {
    setUsers(next);
    write("users:all", next);
  };

  const openCreate = () => {
    setEditing(null);
    setFullName("");
    setEmail("");
    setPassword("");
    setRole("auxiliar");
    setFormError("");
    setFormOpen(true);
  };
  const openEdit = (user: UserProfile) => {
    setEditing(user);
    setFullName(user.full_name);
    setEmail(user.email);
    setPassword("");
    setRole(user.role);
    setFormError("");
    setFormOpen(true);
  };

  const saveUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingForm) return;
    setSavingForm(true);
    setFormError("");
    const result = await executeAction(() => userRequest<{ success: boolean }>(editing ? "PATCH" : "POST", {
      id: editing?.id ?? null,
      full_name: fullName.trim(),
      email: email.trim(),
      password,
      role,
    }));
    if (!result.ok) {
      logSupabaseError(editing ? "Edición de usuario" : "Creación de usuario", result.error);
      setFormError(errorMessage(result.error));
      setSavingForm(false);
      return;
    }
    const wasCreating = !editing;
    setFormOpen(false);
    setMessage(wasCreating ? "Usuario creado correctamente." : "Usuario actualizado correctamente.");
    setActionError("");
    try {
      invalidate("users:all");
      if (wasCreating) adjustActiveCount(1);
      await loadUsers();
    } catch (syncError) {
      logSupabaseError("Sincronización posterior a guardado de usuario", syncError);
      invalidate("users:all");
      invalidate("dashboard:summary");
      setMessage("El usuario se guardó, pero la lista no pudo sincronizarse. Vuelve a abrir Usuarios para confirmarlo.");
    } finally {
      setSavingForm(false);
    }
  };

  const finishAction = async (user: UserProfile, action: "delete" | "restore" | "reactivate") => {
    if (actionInFlight.current || user.id === profile.id) return;
    actionInFlight.current = true;
    setBusyUserId(user.id);
    setActionError("");
    setMessage("");
    const request = action === "delete"
      ? () => userRequest<DeleteResult | UserResult>("DELETE", { id: user.id })
      : action === "restore"
        ? () => userRequest<DeleteResult | UserResult>("PATCH", { action: "restore_user", id: user.id })
        : () => userRequest<DeleteResult | UserResult>("PATCH", {
            action: "set_active", id: user.id, active: true, expected_active: false,
          });
    const result = await executeAction(request);
    if (!result.ok) {
      logSupabaseError("Gestión de usuario", result.error);
      setActionError(errorMessage(result.error));
      if ((result.error as Error & { code?: string }).code === "409") {
        invalidate("users:all");
        void loadUsers();
      }
      setBusyUserId(null);
      actionInFlight.current = false;
      return;
    }

    try {
      const currentUsers = read<UserProfile[]>("users:all")?.data ?? users;
      let updated: UserProfile[];
      if (action === "delete") {
        const deletion = result.data as DeleteResult;
        if (deletion.id !== user.id || !["permanent", "historical"].includes(deletion.mode)) {
          throw new Error("La respuesta no confirmó la eliminación.");
        }
        setDeleteTarget(null);
        updated = deletion.mode === "permanent"
          ? currentUsers.filter((item) => item.id !== user.id)
          : currentUsers.map((item) => item.id === user.id
            ? { ...item, active: false, deleted_at: new Date().toISOString() }
            : item);
        setMessage(deletion.mode === "permanent"
          ? "Usuario eliminado completamente."
          : "Usuario eliminado de la lista normal. Su historial se conserva y perdió el acceso.");
      } else {
        const restored = result.data as UserResult;
        if (restored.user?.id !== user.id || restored.user.active !== true) {
          throw new Error("La respuesta no confirmó la restauración.");
        }
        updated = currentUsers.map((item) => item.id === user.id
          ? { ...item, active: true, deleted_at: null }
          : item);
        setMessage(action === "restore" ? "Usuario restaurado correctamente." : "Usuario reactivado correctamente.");
      }
      updateUserCache(updated);
      adjustActiveCount(action === "delete" ? (user.active ? -1 : 0) : 1);
    } catch (syncError) {
      logSupabaseError("Sincronización posterior a gestión de usuario", syncError);
      invalidate("users:all");
      invalidate("dashboard:summary");
      setMessage("La acción se guardó, pero la lista no pudo sincronizarse. Vuelve a abrir Usuarios para confirmarlo.");
    } finally {
      setBusyUserId(null);
      actionInFlight.current = false;
    }
  };

  const actionsFor = (user: UserProfile) => ({
    user,
    ownAccount: user.id === profile.id,
    busy: busyUserId === user.id,
    onEdit: () => openEdit(user),
    onDelete: () => setDeleteTarget(user),
    onReactivate: () => void finishAction(user, "reactivate"),
    onRestore: () => void finishAction(user, "restore"),
  });

  return (
    <main className="app-page mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.15em] text-blue-300">Administración</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Usuarios</h1>
          <p className="mt-0.5 text-sm text-slate-500">Administra las cuentas y permisos del sistema.</p>
        </div>
        <button type="button" onClick={openCreate} className="app-button-primary min-h-11 px-4 py-2 text-sm">
          <AppIcon name="plus" className="h-4 w-4" /> Nuevo usuario
        </button>
      </header>

      <section aria-label="Filtros de usuarios" className="app-card grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]">
        <div className="app-field flex items-center gap-2 px-3"><AppIcon name="search" className="h-4 w-4 shrink-0 text-slate-400" /><input aria-label="Buscar por nombre o correo" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o correo" className="min-h-11 min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" /></div>
        <select aria-label="Filtrar por rol" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as Role | "todos")} className="app-field px-3 text-sm">
          <option value="todos">Todos los roles</option>
          <option value="administrador">Administrador</option>
          <option value="planeador">Planeador</option>
          <option value="auxiliar">Auxiliar</option>
        </select>
        <select aria-label="Filtrar por estado" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as StateFilter)} className="app-field px-3 text-sm">
          <option value="vigentes">Vigentes</option>
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
          <option value="eliminados">Eliminados</option>
          <option value="todos">Todos los estados</option>
        </select>
      </section>

      {message && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</p>}
      {actionError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{actionError}</p>}
      {loadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{loadError} <button type="button" onClick={() => void loadUsers()} className="font-semibold underline">Reintentar</button></p>}

      <section aria-label="Listado de usuarios">
        <p className="mb-2 text-xs font-medium text-slate-500">{loading && !users.length ? "Cargando usuarios…" : `${visibleUsers.length} usuario(s)`}</p>
        {loading && !users.length ? (
          <div className="app-card h-40 animate-pulse" />
        ) : visibleUsers.length === 0 ? (
          <div className="app-card px-5 py-10 text-center text-sm text-slate-500">No hay usuarios para estos filtros.</div>
        ) : (
          <>
            <div className="app-card hidden overflow-visible lg:block">
              <table className="app-table table-fixed text-left text-sm">
                <thead className="border-b border-slate-100 bg-[#122033] text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <tr><th className="w-[39%] px-4 py-3">Usuario</th><th className="w-[17%] px-4 py-3">Rol</th><th className="w-[15%] px-4 py-3">Estado</th><th className="w-[20%] px-4 py-3">Fecha de creación</th><th className="w-[9%] px-4 py-3 text-right">Acciones</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleUsers.map((user) => (
                    <tr key={user.id}>
                      <td className="px-4 py-2.5"><div className="flex min-w-0 items-center gap-3"><Avatar user={user} /><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{user.full_name}</p><p className="truncate text-xs text-slate-500">{user.email}</p></div></div></td>
                      <td className="px-4 py-2.5"><span className="inline-flex rounded-full border border-blue-400/15 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-200">{roleLabel(user.role)}</span></td>
                      <td className="px-4 py-2.5"><StateBadge user={user} /></td>
                      <td className="px-4 py-2.5 text-slate-600">{new Date(user.created_at).toLocaleDateString("es-CO")}</td>
                      <td className="px-4 py-2.5 text-right"><UserActions {...actionsFor(user)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-2.5 lg:hidden sm:grid-cols-2">
              {visibleUsers.map((user) => (
                <article key={user.id} className="app-card p-4">
                  <div className="flex min-w-0 items-center gap-3"><Avatar user={user} /><div className="min-w-0"><h2 className="truncate text-sm font-semibold text-slate-900">{user.full_name}</h2><p className="truncate text-xs text-slate-500">{user.email}</p></div></div>
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs"><div><p className="mb-1 text-slate-400">Rol</p><span className="inline-flex rounded-full border border-blue-400/15 bg-blue-500/10 px-2.5 py-1 font-medium text-blue-200">{roleLabel(user.role)}</span></div><div><p className="mb-1 text-slate-400">Estado</p><StateBadge user={user} /></div></div>
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500"><span>Creado el {new Date(user.created_at).toLocaleDateString("es-CO")}</span><UserActions {...actionsFor(user)} /></div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {formOpen && (
        <Modal title={editing ? "Editar usuario" : "Nuevo usuario"} description={editing ? "Actualiza el nombre y los permisos de la cuenta." : "Crea una cuenta para acceder al sistema."} icon={<AppIcon name="users" className="h-5 w-5" />} closeDisabled={savingForm} onClose={() => { if (!savingForm) setFormOpen(false); }}>
          <form onSubmit={(event) => void saveUser(event)} className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
            <label className="grid gap-1 text-sm font-medium text-slate-300 sm:col-span-2">Nombre completo<input required value={fullName} onChange={(event) => setFullName(event.target.value)} className="app-field px-3" /></label>
            <label className="grid gap-1 text-sm font-medium text-slate-300">Correo electrónico<input required type="email" disabled={Boolean(editing)} value={email} onChange={(event) => setEmail(event.target.value)} className="app-field px-3 disabled:opacity-60" /></label>
            {!editing && <label className="grid gap-1 text-sm font-medium text-slate-300">Contraseña<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="app-field px-3" /></label>}
            <label className="grid gap-1 text-sm font-medium text-slate-300">Rol<select value={role} onChange={(event) => setRole(event.target.value as Role)} className="app-field px-3"><option value="auxiliar">Auxiliar</option><option value="planeador">Planeador</option><option value="administrador">Administrador</option></select></label>
            {formError && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{formError}</p>}
            <div className="flex flex-wrap justify-end gap-2 sm:col-span-2"><button type="button" disabled={savingForm} onClick={() => setFormOpen(false)} className="app-button-secondary min-h-11 px-4 text-sm">Cancelar</button><button disabled={savingForm} className="app-button-primary min-h-11 px-4 text-sm">{savingForm ? "Guardando…" : editing ? "Guardar cambios" : "Crear usuario"}</button></div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Eliminar usuario" icon={<AppIcon name="ban" className="h-5 w-5" />} closeDisabled={busyUserId === deleteTarget.id} onClose={() => { if (busyUserId !== deleteTarget.id) setDeleteTarget(null); }}>
          <div className="space-y-3 p-5 text-sm text-slate-300 sm:p-6">
            <p>¿Seguro que deseas eliminar a <strong>{deleteTarget.full_name}</strong>?</p>
            <p className="text-slate-500">{deleteTarget.email}</p>
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 font-medium text-red-800">Este usuario perderá el acceso al sistema.</p>
            <p className="text-xs text-slate-500">Si tiene historial, su perfil se conservará para mantener las órdenes y auditorías relacionadas.</p>
            {actionError && <p role="alert" className="text-sm text-red-700">{actionError}</p>}
            <div className="flex flex-wrap justify-end gap-2 pt-2"><button type="button" disabled={busyUserId === deleteTarget.id} onClick={() => setDeleteTarget(null)} className="app-button-secondary min-h-11 px-4">Cancelar</button><button type="button" disabled={busyUserId === deleteTarget.id} onClick={() => void finishAction(deleteTarget, "delete")} className="app-button-danger min-h-11 px-4">{busyUserId === deleteTarget.id ? "Eliminando…" : "Eliminar usuario"}</button></div>
          </div>
        </Modal>
      )}
    </main>
  );
}

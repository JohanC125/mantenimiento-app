"use client";
import { createContext, useContext, useMemo, useState } from "react";
import { DashboardCache } from "@/lib/dashboard-cache";

export type DashboardRole = "administrador" | "planeador" | "auxiliar";
export type DashboardProfile = { id: string; full_name: string; role: DashboardRole; active: boolean };
type DashboardDataContextValue = Pick<DashboardCache, "read" | "fetch" | "write" | "invalidate" | "version" | "changeOrder"> & { profile: DashboardProfile; revision: number };
const DashboardDataContext = createContext<DashboardDataContextValue | null>(null);
export default function DashboardDataProvider({ profile, children }: { profile: DashboardProfile; children: React.ReactNode }) {
  const [revision, setRevision] = useState(0);
  const [cache] = useState(() => new DashboardCache(() => setRevision(value => value + 1)));
  const value = useMemo(() => ({ profile, read: cache.read, fetch: cache.fetch, write: cache.write, invalidate: cache.invalidate, version: cache.version, changeOrder: cache.changeOrder, revision }), [profile, cache, revision]);
  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}
export function useDashboardData() {
  const context = useContext(DashboardDataContext);
  if (!context) throw new Error("DashboardDataProvider no está disponible.");
  return context;
}

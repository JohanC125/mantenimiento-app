import type { ReactNode, SVGProps } from "react";

export type AppIconName = "tool" | "home" | "site" | "users" | "logout" | "menu" | "close" | "clock" | "search" | "plus" | "calendar" | "check" | "activity" | "refresh" | "ban" | "arrow" | "chevron" | "document";

const paths: Record<AppIconName, ReactNode> = {
  tool: <><path d="M14.7 6.3a4.5 4.5 0 0 0-5.9 5.9l-5.7 5.7a2 2 0 0 0 2.8 2.8l5.7-5.7a4.5 4.5 0 0 0 5.9-5.9l-2.7 2.7-3-3 2.9-2.5Z" /></>,
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z" /><path d="M9 21v-7h6v7" /></>,
  site: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 21v-4h6v4M8 8h2m4 0h2M8 12h2m4 0h2" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2H3Zm14-15a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <><path d="M5 5 19 19M19 5 5 19" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /></>,
  check: <><path d="m4 12 5 5L20 6" /></>,
  activity: <><path d="M3 12h4l3-7 4 14 3-7h4" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 9a7 7 0 0 1 12-2l2 5M4 12l2 5a7 7 0 0 0 12-2" /></>,
  ban: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
  arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
  chevron: <><path d="m6 9 6 6 6-6" /></>,
  document: <><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5M9 13h6m-6 4h6" /></>,
};

export function AppIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: AppIconName }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>{paths[name]}</svg>;
}

export function AppBrand({ compact = false }: { compact?: boolean }) {
  return <div className={`flex items-center transition-[gap] duration-200 ${compact ? "gap-0" : "gap-3"}`}>
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-blue-400/35 bg-blue-500/15 text-blue-300 shadow-[0_0_22px_rgba(38,132,255,.12)]"><AppIcon name="tool" className="h-6 w-6" /></span>
    <span aria-hidden={compact} className={`min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ${compact ? "max-w-0 opacity-0" : "max-w-48 opacity-100"}`}><span className="block truncate text-sm font-bold tracking-wide text-slate-50">OT Mantenimiento</span><span className="block text-xs text-slate-400">Gestión de órdenes</span></span>
  </div>;
}

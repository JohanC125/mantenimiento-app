"use client";

import { AppIcon } from "@/components/ui/AppIcon";

const numbers = (limit: number) =>
  Array.from({ length: limit }, (_, value) => String(value).padStart(2, "0"));
export function TimeField({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  id: string;
}) {
  const [hour = "", minute = ""] = value.split(":");
  return (
    <div className="app-field inline-flex w-full max-w-64 items-center gap-1 p-1 pr-2 focus-within:border-blue-400/70 focus-within:ring-2 focus-within:ring-blue-500/10">
      <AppIcon name="clock" className="mx-2 h-4 w-4 shrink-0 text-blue-300" />
      <select
        id={id}
        aria-label="Hora"
        value={hour}
        onChange={(event) =>
          onChange(`${event.target.value || "00"}:${minute || "00"}`)
        }
        className="min-h-11 w-[4.7rem] shrink-0 rounded-md border-0 bg-transparent px-2 text-center text-sm font-semibold text-slate-100 outline-none focus:ring-0"
      >
        <option value="">HH</option>
        {numbers(24).map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <span aria-hidden className="text-sm font-bold text-slate-400">
        :
      </span>
      <select
        aria-label="Minutos"
        value={minute}
        onChange={(event) =>
          onChange(`${hour || "00"}:${event.target.value || "00"}`)
        }
        className="min-h-11 w-[4.7rem] shrink-0 rounded-md border-0 bg-transparent px-2 text-center text-sm font-semibold text-slate-100 outline-none focus:ring-0"
      >
        <option value="">MM</option>
        {numbers(60).map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </div>
  );
}

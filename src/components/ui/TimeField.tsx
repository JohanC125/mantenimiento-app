"use client";

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
    <div className="flex items-center gap-2">
      <select
        id={id}
        aria-label="Hora"
        value={hour}
        onChange={(event) =>
          onChange(`${event.target.value || "00"}:${minute || "00"}`)
        }
        className="min-h-11 flex-1 rounded-lg border bg-white px-3 py-2"
      >
        <option value="">HH</option>
        {numbers(24).map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <span aria-hidden className="font-bold text-slate-500">
        :
      </span>
      <select
        aria-label="Minutos"
        value={minute}
        onChange={(event) =>
          onChange(`${hour || "00"}:${event.target.value || "00"}`)
        }
        className="min-h-11 flex-1 rounded-lg border bg-white px-3 py-2"
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

import { createBrowserClient } from '@supabase/ssr'

const sessionCookieName = "sb-mantenimiento-session";

function browserCookies() {
  return {
    getAll() {
      if (typeof document === "undefined") return [];
      return document.cookie.split("; ").filter((entry) => entry.includes("=")).map((entry) => {
        const separator = entry.indexOf("=");
        return { name: decodeURIComponent(entry.slice(0, separator)), value: decodeURIComponent(entry.slice(separator + 1)) };
      });
    },
    setAll(cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>) {
      if (typeof document === "undefined") return;
      cookies.forEach(({ name, value, options }) => {
        const isRemoval = options.maxAge === 0;
        const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`, `Path=${String(options.path || "/")}`];
        if (options.domain) parts.push(`Domain=${String(options.domain)}`);
        if (options.sameSite) parts.push(`SameSite=${String(options.sameSite)}`);
        if (options.secure) parts.push("Secure");
        if (isRemoval) parts.push("Max-Age=0");
        document.cookie = parts.join("; ");
      });
    },
  };
}

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { cookies: browserCookies(), cookieOptions: { name: sessionCookieName } },
)

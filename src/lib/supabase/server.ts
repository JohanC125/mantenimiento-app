import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

function sessionCookieOptions(options: CookieOptions) {
    if (options.maxAge === 0) return options;
    const sessionOptions = { ...options };
    delete sessionOptions.maxAge;
    delete sessionOptions.expires;
    return sessionOptions;
}

/**
 * Creates a request-scoped Supabase client using the authenticated user's
 * browser cookies. This client deliberately uses the publishable key and is
 * safe for authorization checks in Route Handlers and Server Components.
 */
export async function createServerSupabaseClient() {
    const cookieStore = await cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
            cookieOptions: { name: "sb-mantenimiento-session" },
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            cookieStore.set(name, value, sessionCookieOptions(options));
                        });
                    } catch {
                        // Server Components cannot write cookies. Route Handlers
                        // can, and proxy.ts refreshes sessions before rendering.
                    }
                },
            },
        }
    );
}

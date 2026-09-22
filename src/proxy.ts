import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const allowedRoles = new Set([
    "administrador",
    "planeador",
    "auxiliar",
]);

function redirectWithSessionCookies(
    request: NextRequest,
    sessionResponse: NextResponse,
    destination: string
) {
    const response = NextResponse.redirect(new URL(destination, request.url));

    sessionResponse.cookies.getAll().forEach((cookie) => {
        response.cookies.set(cookie);
    });

    return response;
}

function sessionCookieOptions(options: Record<string, unknown> | undefined) {
    if (options?.maxAge === 0) return options;
    const sessionOptions = { ...(options || {}) };
    delete sessionOptions.maxAge;
    delete sessionOptions.expires;
    return sessionOptions;
}

export async function proxy(request: NextRequest) {
    let sessionResponse = NextResponse.next({ request });

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
            cookieOptions: { name: "sb-mantenimiento-session" },
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => {
                        request.cookies.set(name, value);
                    });

                    sessionResponse = NextResponse.next({ request });

                    cookiesToSet.forEach(({ name, value, options }) => {
                        sessionResponse.cookies.set(name, value, sessionCookieOptions(options as Record<string, unknown>));
                    });
                },
            },
        }
    );

    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
        return redirectWithSessionCookies(request, sessionResponse, "/login");
    }

    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, active")
        .eq("id", user.id)
        .single();

    if (
        profileError ||
        !profile ||
        !profile.active ||
        !allowedRoles.has(profile.role)
    ) {
        return redirectWithSessionCookies(request, sessionResponse, "/login");
    }

    const isAdministrativeDashboardRoute = [
        "/dashboard/usuarios",
        "/dashboard/sedes",
    ].some((route) => request.nextUrl.pathname.startsWith(route));

    if (isAdministrativeDashboardRoute && profile.role !== "administrador") {
        return redirectWithSessionCookies(
            request,
            sessionResponse,
            "/dashboard"
        );
    }

    return sessionResponse;
}

export const config = {
    matcher: ["/dashboard/:path*"],
};

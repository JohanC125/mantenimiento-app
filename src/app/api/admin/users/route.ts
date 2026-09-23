import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { adminSession } from "@/lib/admin-api";

const ADMIN_ROLE = "administrador";

export async function PATCH(request: Request) {
    try {
        const session = await adminSession();
        if (session.response) return session.response;
        const body = await request.json();
        if (!body || typeof body !== "object" || typeof body.id !== "string") {
            return NextResponse.json({ error: "Datos de perfil inválidos" }, { status: 400 });
        }
        const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

        if (body.action === "set_active") {
            if (typeof body.active !== "boolean" || typeof body.expected_active !== "boolean" || body.active === body.expected_active) {
                return NextResponse.json({ error: "Cambio de estado inválido" }, { status: 400 });
            }
            if (body.id === session.user.id) {
                return NextResponse.json({ error: "No puedes cambiar el estado de tu propia cuenta." }, { status: 403 });
            }
            const result = await admin.from("profiles")
                .update({ active: body.active })
                .eq("id", body.id)
                .eq("active", body.expected_active)
                .is("deleted_at", null)
                .select("id, active")
                .maybeSingle();
            if (result.error) return NextResponse.json({ error: "No se pudo cambiar el estado del usuario." }, { status: 400 });
            if (!result.data) return NextResponse.json({ error: "El estado del usuario cambió. Actualiza la lista antes de reintentar." }, { status: 409 });
            return NextResponse.json({ user: result.data });
        }

        if (body.action === "restore_user") {
            if (body.id === session.user.id) {
                return NextResponse.json({ error: "No puedes restaurar tu propia cuenta." }, { status: 403 });
            }
            const { data: authUser, error: authError } = await admin.auth.admin.getUserById(body.id);
            if (authError || !authUser.user) {
                return NextResponse.json({ error: "La cuenta de Auth no está disponible para restauración." }, { status: 409 });
            }
            const result = await admin.from("profiles")
                .update({ active: true, deleted_at: null, deleted_by: null })
                .eq("id", body.id)
                .not("deleted_at", "is", null)
                .select("id, active, deleted_at")
                .maybeSingle();
            if (result.error) return NextResponse.json({ error: "No se pudo restaurar el usuario." }, { status: 400 });
            if (!result.data) return NextResponse.json({ error: "El usuario ya no figura como eliminado." }, { status: 409 });
            return NextResponse.json({ user: result.data });
        }

        if ("active" in body || typeof body.full_name !== "string" || !body.full_name.trim() || !["administrador", "auxiliar", "planeador"].includes(body.role)) {
            return NextResponse.json({ error: "Datos de perfil inválidos" }, { status: 400 });
        }
        if (body.id === session.user.id && body.role !== "administrador") {
            return NextResponse.json({ error: "No puedes quitarte el rol administrador." }, { status: 400 });
        }
        const result = await admin.from("profiles").update({ full_name: body.full_name.trim(), role: body.role }).eq("id", body.id).is("deleted_at", null).select("id").single();
        if (result.error) return NextResponse.json({ error: "No se pudo actualizar el perfil" }, { status: 400 });
        return NextResponse.json({ success: true });
    } catch { return NextResponse.json({ error: "Solicitud inválida o servicio no disponible" }, { status: 400 }); }
}

export async function DELETE(request: Request) {
    try {
        const session = await adminSession();
        if (session.response) return session.response;
        const body: unknown = await request.json();
        if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string") {
            return NextResponse.json({ error: "Usuario inválido." }, { status: 400 });
        }
        if (body.id === session.user.id) {
            return NextResponse.json({ error: "No puedes eliminar tu propia cuenta." }, { status: 403 });
        }

        const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
        const prepared = await admin.rpc("prepare_user_deletion", {
            p_target_id: body.id,
            p_actor_id: session.user.id,
        });
        if (prepared.error) {
            return NextResponse.json({ error: "No se pudo verificar la integridad del usuario. Comprueba que la migración de eliminación esté aplicada." }, { status: 409 });
        }

        if (prepared.data === true) {
            const { error: deleteError } = await admin.auth.admin.deleteUser(body.id, false);
            if (!deleteError) {
                return NextResponse.json({ mode: "permanent", id: body.id });
            }
        }

        // The database preparation already removed access and hid the profile.
        // An Auth deletion rejected by a concurrent FK leaves this safe state.
        return NextResponse.json({ mode: "historical", id: body.id });
    } catch {
        return NextResponse.json({ error: "Solicitud inválida o servicio no disponible." }, { status: 400 });
    }
}

export async function POST(request: Request) {
    try {
        const supabase = await createServerSupabaseClient();

        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: "No autenticado." },
                { status: 401 }
            );
        }

        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("id, role, active")
            .eq("id", user.id)
            .single();

        if (
            profileError ||
            !profile ||
            !profile.active ||
            profile.role !== ADMIN_ROLE
        ) {
            return NextResponse.json(
                { error: "No tienes permiso para gestionar usuarios." },
                { status: 403 }
            );
        }

        let body: unknown;

        try {
            body = await request.json();
        } catch {
            return NextResponse.json(
                { error: "El cuerpo de la solicitud no es válido." },
                { status: 400 }
            );
        }

        if (!body || typeof body !== "object") {
            return NextResponse.json(
                { error: "El cuerpo de la solicitud no es válido." },
                { status: 400 }
            );
        }

        const { full_name, email, password, role } = body as Record<
            string,
            unknown
        >;

        if (
            typeof full_name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            typeof role !== "string" ||
            !full_name.trim() ||
            !email.trim() ||
            !password
        ) {
            return NextResponse.json(
                { error: "Todos los campos son obligatorios." },
                { status: 400 }
            );
        }

        const allowedRoles = [ADMIN_ROLE, "planeador", "auxiliar"];

        if (!allowedRoles.includes(role)) {
            return NextResponse.json(
                { error: "El rol seleccionado no es válido." },
                { status: 400 }
            );
        }

        // The service-role client is created only after the caller has been
        // verified as an authenticated, active administrator.
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data: authData, error: authError } =
            await supabaseAdmin.auth.admin.createUser({
                email: email.trim(),
                password,
                email_confirm: true,
            });

        if (authError) {
            return NextResponse.json(
                { error: authError.message },
                { status: 400 }
            );
        }

        if (!authData.user) {
            return NextResponse.json(
                { error: "No se pudo crear el usuario." },
                { status: 500 }
            );
        }

        const { error: profileInsertError } = await supabaseAdmin
            .from("profiles")
            .insert({
                id: authData.user.id,
                full_name: full_name.trim(),
                email: email.trim(),
                role,
                active: true,
            });

        if (profileInsertError) {
            await supabaseAdmin.auth.admin.deleteUser(authData.user.id);

            return NextResponse.json(
                { error: profileInsertError.message },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            message: "Usuario creado correctamente.",
        });
    } catch (error) {
        console.error(error);

        return NextResponse.json(
            { error: "Error interno del servidor." },
            { status: 500 }
        );
    }
}

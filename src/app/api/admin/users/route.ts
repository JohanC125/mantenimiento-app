import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
    try {
        const body = await request.json();

        const { full_name, email, password, role } = body;

        if (!full_name || !email || !password || !role) {
            return NextResponse.json(
                { error: "Todos los campos son obligatorios." },
                { status: 400 }
            );
        }

        const allowedRoles = ["administrador", "ingeniero", "auxiliar"];

        if (!allowedRoles.includes(role)) {
            return NextResponse.json(
                { error: "El rol seleccionado no es válido." },
                { status: 400 }
            );
        }

        const { data: authData, error: authError } =
            await supabaseAdmin.auth.admin.createUser({
                email,
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

        const { error: profileError } = await supabaseAdmin
            .from("profiles")
            .insert({
                id: authData.user.id,
                full_name,
                email,
                role,
                active: true,
            });

        if (profileError) {
            await supabaseAdmin.auth.admin.deleteUser(authData.user.id);

            return NextResponse.json(
                { error: profileError.message },
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
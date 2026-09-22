import { adminSession } from "@/lib/admin-api";

async function save(request: Request, editing: boolean) {
  try {
    const session = await adminSession();
    if (session.response) return session.response;
    const body = await request.json();
    if (!body || typeof body.name !== "string" || !body.name.trim() || typeof body.active !== "boolean" || typeof body.requires_coproperty !== "boolean" || typeof body.address !== "string" || typeof body.city !== "string" || (editing && (!Number.isSafeInteger(body.id) || body.id <= 0))) {
      return Response.json({ error: "Datos de sede inválidos" }, { status: 400 });
    }
    const data = { name: body.name.trim(), address: body.address.trim() || null, city: body.city.trim() || null, active: body.active, requires_coproperty: body.requires_coproperty };
    const query = editing ? session.supabase.from("sites").update(data).eq("id", body.id) : session.supabase.from("sites").insert(data);
    const result = await query.select("id").single();
    if (result.error) return Response.json({ error: "No se pudo guardar la sede. Verifica los permisos y datos en Supabase." }, { status: 400 });
    return Response.json({ success: true });
  } catch { return Response.json({ error: "Solicitud inválida o servicio no disponible" }, { status: 400 }); }
}
export async function POST(request: Request) { return save(request, false); }
export async function PATCH(request: Request) { return save(request, true); }

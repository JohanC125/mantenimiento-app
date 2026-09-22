export function errorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    if (error.message.includes("order_document_checks_unique")) return "La base de datos está creando validaciones duplicadas. Revisa el diagnóstico de triggers y RPC antes de volver a crear la OT.";
    if (error.message.includes("schema cache") || error.message.includes("does not exist")) return "Falta aplicar o verificar la migración de operaciones en Supabase. Consulta docs/OPERACION.md.";
    if (error.message.trim()) return error.message;
  }
  return "No fue posible completar la operación. Reintenta.";
}

export function logSupabaseError(context: string, error: unknown) {
  if (error == null) return;
  const source = normalizeError(error);
  // An explicit string survives dev-overlay serialization of Error objects.
  console.error(`[${context}] ${source.message}`, { context, message: source.message, code: source.code, details: source.details, hint: source.hint, stack: source.stack });
}

export function normalizeError(value: unknown): Error & { code?: string; details?: string; hint?: string } {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const message = typeof source.message === "string" && source.message.trim() ? source.message : typeof value === "string" && value.trim() ? value : "La operación falló sin diagnóstico del servicio; comprueba la respuesta de red antes de reintentar.";
  const error = value instanceof Error ? value : new Error(message);
  return Object.assign(error, {
    code: typeof source.code === "string" ? source.code : undefined,
    details: typeof source.details === "string" ? source.details : undefined,
    hint: typeof source.hint === "string" ? source.hint : undefined,
  });
}

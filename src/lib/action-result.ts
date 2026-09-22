import { normalizeError } from "./errors";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: Error };

// Only the RPC belongs in this boundary. A subsequent UI failure must not
// misreport a committed mutation as a failed RPC or invite a duplicate retry.
export async function executeAction<T>(request: () => PromiseLike<{ data: T; error: unknown }>): Promise<ActionResult<T>> {
  try {
    const result = await request();
    if (result.error != null) return { ok: false, error: normalizeError(result.error) };
    return { ok: true, data: result.data };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

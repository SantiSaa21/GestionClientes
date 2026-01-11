import { NextResponse } from "next/server";
import {
  createSupabaseAdmin,
  createSupabaseAnonServer,
  createSupabaseAuthedServer,
} from "@/lib/supabase/server";

type Body = {
  // optional, used only to add an extra guard if provided
  clientId?: string;
};

function json(status: number, data: unknown) {
  return NextResponse.json(data, { status });
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await ctx.params;

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) return json(401, { error: "Missing bearer token" });

    const supabaseAnon = createSupabaseAnonServer();
    const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(token);

    if (userErr || !userData.user) return json(401, { error: "Invalid token" });

    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (adminEmails.length > 0) {
      const email = (userData.user.email ?? "").toLowerCase();
      if (!adminEmails.includes(email)) return json(403, { error: "Forbidden" });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    if (body.clientId && body.clientId !== clientId) {
      return json(400, { error: "clientId mismatch" });
    }

    const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const supabasePriv = hasServiceRole
      ? createSupabaseAdmin()
      : createSupabaseAuthedServer(token);

    // 1) Verificar cliente
    const { data: clientRow, error: clientErr } = await supabasePriv
      .from("clients")
      .select("id, deleted_at")
      .eq("id", clientId)
      .maybeSingle();

    if (clientErr) return json(500, { error: "DB error", details: clientErr.message });
    if (!clientRow) return json(404, { error: "Client not found" });

    // 2) Buscar archivos para borrar físicamente del Storage (incluye soft-deleted)
    const { data: files, error: filesErr } = await supabasePriv
      .from("files")
      .select("id, bucket, path, deleted_at")
      .eq("client_id", clientId);

    if (filesErr) return json(500, { error: "DB error", details: filesErr.message });

    const byBucket = new Map<string, string[]>();
    for (const f of files ?? []) {
      const bucket = String((f as { bucket?: unknown }).bucket ?? "");
      const path = String((f as { path?: unknown }).path ?? "");
      if (!bucket || !path) continue;
      const cur = byBucket.get(bucket) ?? [];
      cur.push(path);
      byBucket.set(bucket, cur);
    }

    // 3) Borrar físicamente del Storage (en chunks)
    for (const [bucket, paths] of byBucket.entries()) {
      for (const part of chunk(paths, 100)) {
        const { error: rmErr } = await supabasePriv.storage.from(bucket).remove(part);
        if (!rmErr) continue;

        const msg = rmErr.message || "Storage delete failed";
        if (!msg.toLowerCase().includes("not found")) {
          if (!hasServiceRole) {
            return json(403, {
              error: "Storage delete forbidden",
              details:
                msg +
                " (Configura policy de delete en Storage o agrega SUPABASE_SERVICE_ROLE_KEY en el servidor)",
            });
          }
          return json(500, { error: "Storage delete failed", details: msg });
        }
      }
    }

    // 4) Borrado de datos (hard delete; fallback soft delete)
    const now = new Date().toISOString();

    async function hardDelete(table: string, match: Record<string, string>) {
      let q = supabasePriv.from(table).delete();
      for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
      return await q;
    }

    async function softDelete(table: string, match: Record<string, string>) {
      let q = supabasePriv.from(table).update({ deleted_at: now });
      for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
      return await q;
    }

    // Hijos primero
    const delFiles = await hardDelete("files", { client_id: clientId });
    if (delFiles.error) {
      const soft = await softDelete("files", { client_id: clientId });
      if (soft.error) {
        const msg = soft.error.message || delFiles.error.message || "DB write failed";
        if (!hasServiceRole) return json(403, { error: "DB write forbidden", details: msg });
        return json(500, { error: "DB write failed", details: msg });
      }
    }

    const delDocs = await hardDelete("client_documents", { client_id: clientId });
    if (delDocs.error) {
      const soft = await softDelete("client_documents", { client_id: clientId });
      if (soft.error) {
        const msg = soft.error.message || delDocs.error.message || "DB write failed";
        if (!hasServiceRole) return json(403, { error: "DB write forbidden", details: msg });
        return json(500, { error: "DB write failed", details: msg });
      }
    }

    const delPayments = await hardDelete("client_payments", { client_id: clientId });
    if (delPayments.error) {
      const soft = await softDelete("client_payments", { client_id: clientId });
      if (soft.error) {
        const msg = soft.error.message || delPayments.error.message || "DB write failed";
        if (!hasServiceRole) return json(403, { error: "DB write forbidden", details: msg });
        return json(500, { error: "DB write failed", details: msg });
      }
    }

    const delOwners = await hardDelete("client_ownerships", { client_id: clientId });
    if (delOwners.error) {
      const soft = await softDelete("client_ownerships", { client_id: clientId });
      if (soft.error) {
        const msg = soft.error.message || delOwners.error.message || "DB write failed";
        if (!hasServiceRole) return json(403, { error: "DB write forbidden", details: msg });
        return json(500, { error: "DB write failed", details: msg });
      }
    }

    const delClient = await hardDelete("clients", { id: clientId });
    if (delClient.error) {
      const soft = await softDelete("clients", { id: clientId });
      if (soft.error) {
        const msg = soft.error.message || delClient.error.message || "DB write failed";
        if (!hasServiceRole) return json(403, { error: "DB write forbidden", details: msg });
        return json(500, { error: "DB write failed", details: msg });
      }
    }

    return json(200, { ok: true, removedFiles: (files ?? []).length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[api/clients/[clientId]/delete]", msg);
    return json(500, { error: "Server error", details: msg });
  }
}

import { NextResponse } from "next/server";
import {
  createSupabaseAdmin,
  createSupabaseAnonServer,
  createSupabaseAuthedServer,
} from "@/lib/supabase/server";

type Body = {
  clientId?: string;
};

function json(status: number, data: unknown) {
  return NextResponse.json(data, { status });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await ctx.params;

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) return json(401, { error: "Missing bearer token" });

    // Verifica que sea un usuario autenticado (admin app)
    const supabaseAnon = createSupabaseAnonServer();
    const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(token);

    if (userErr || !userData.user) return json(401, { error: "Invalid token" });

    // Si quieres restringir a una lista de admins, setea ADMIN_EMAILS="a@x.com,b@y.com"
    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (adminEmails.length > 0) {
      const email = (userData.user.email ?? "").toLowerCase();
      if (!adminEmails.includes(email)) return json(403, { error: "Forbidden" });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const clientId = body.clientId;

    if (!clientId) return json(400, { error: "Missing clientId" });

    const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const supabasePriv = hasServiceRole
      ? createSupabaseAdmin()
      : createSupabaseAuthedServer(token);

    // 1) Buscar metadata del archivo
    const { data: fileRow, error: fileErr } = await supabasePriv
      .from("files")
      .select("id, client_id, bucket, path, deleted_at")
      .eq("id", fileId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (fileErr) return json(500, { error: "DB error", details: fileErr.message });
    if (!fileRow) return json(404, { error: "File not found" });

    const bucket = "bucket" in fileRow ? String((fileRow as { bucket?: unknown }).bucket ?? "") : "";
    const path = "path" in fileRow ? String((fileRow as { path?: unknown }).path ?? "") : "";

    if (!bucket || !path) return json(500, { error: "Invalid file row" });

    // 2) Borrar físicamente del Storage
    const { error: rmErr } = await supabasePriv.storage.from(bucket).remove([path]);
    if (rmErr) {
      const msg = rmErr.message || "Storage delete failed";

      // Idempotente: si ya no existe en Storage, seguimos con soft delete.
      if (!msg.toLowerCase().includes("not found")) {
        // Si no hay service role, lo más común es que falten policies de delete.
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

    // 3) Soft delete en tabla files (auditoría)
    // (si ya estaba soft-deleted, igual lo dejamos idempotente)
    const { error: upErr } = await supabasePriv
      .from("files")
      .update({ deleted_at: fileRow.deleted_at ?? new Date().toISOString() })
      .eq("id", fileId)
      .eq("client_id", clientId);

    if (upErr) {
      const msg = upErr.message || "DB update failed";
      if (!hasServiceRole) {
        return json(403, {
          error: "DB update forbidden",
          details:
            msg +
            " (Configura RLS para permitir update/soft-delete o agrega SUPABASE_SERVICE_ROLE_KEY en el servidor)",
        });
      }
      return json(500, { error: "DB update failed", details: msg });
    }

    return json(200, { ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[api/files/[fileId]/delete]", msg);
    return json(500, { error: "Server error", details: msg });
  }
}

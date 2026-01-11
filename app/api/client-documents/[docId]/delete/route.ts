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
  ctx: { params: Promise<{ docId: string }> }
) {
  try {
    const { docId } = await ctx.params;

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

    // 1) Buscar el documento
    const { data: docRow, error: docErr } = await supabasePriv
      .from("client_documents")
      .select("id, client_id, document_type_id, custom_name, deleted_at")
      .eq("id", docId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (docErr) return json(500, { error: "DB error", details: docErr.message });
    if (!docRow) return json(404, { error: "Document not found" });

    // Solo permitimos borrar documentos "Otros" personalizados (custom_name + sin tipo)
    // para evitar eliminar documentos predefinidos/requeridos por error.
    if (docRow.document_type_id || !docRow.custom_name) {
      return json(403, {
        error: "Forbidden",
        details: "Solo se pueden eliminar documentos personalizados (Otros con alias).",
      });
    }

    // 2) Traer archivos asociados
    const { data: files, error: filesErr } = await supabasePriv
      .from("files")
      .select("id, bucket, path, deleted_at")
      .eq("client_id", clientId)
      .eq("client_document_id", docId);

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

    // 3) Borrar físicamente del Storage
    for (const [bucket, paths] of byBucket.entries()) {
      if (paths.length === 0) continue;
      const { error: rmErr } = await supabasePriv.storage.from(bucket).remove(paths);
      if (rmErr) {
        const msg = rmErr.message || "Storage delete failed";

        // Idempotente: si ya no existe en Storage, seguimos.
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

    // 4) Borrar filas de archivos (hard delete; fallback soft delete)
    const now = new Date().toISOString();

    const { error: delFilesErr } = await supabasePriv
      .from("files")
      .delete()
      .eq("client_id", clientId)
      .eq("client_document_id", docId);

    if (delFilesErr) {
      const { error: softFilesErr } = await supabasePriv
        .from("files")
        .update({ deleted_at: now })
        .eq("client_id", clientId)
        .eq("client_document_id", docId);

      if (softFilesErr) {
        const msg = softFilesErr.message || delFilesErr.message || "DB write failed";
        if (!hasServiceRole) {
          return json(403, {
            error: "DB write forbidden",
            details:
              msg +
              " (Configura RLS para permitir delete/update o agrega SUPABASE_SERVICE_ROLE_KEY en el servidor)",
          });
        }
        return json(500, { error: "DB write failed", details: msg });
      }
    }

    // 5) Borrar documento (hard delete; fallback soft delete)
    const { error: delDocErr } = await supabasePriv
      .from("client_documents")
      .delete()
      .eq("id", docId)
      .eq("client_id", clientId);

    if (delDocErr) {
      const { error: softDocErr } = await supabasePriv
        .from("client_documents")
        .update({ deleted_at: now })
        .eq("id", docId)
        .eq("client_id", clientId);

      if (softDocErr) {
        const msg = softDocErr.message || delDocErr.message || "DB write failed";
        if (!hasServiceRole) {
          return json(403, {
            error: "DB write forbidden",
            details:
              msg +
              " (Configura RLS para permitir delete/update o agrega SUPABASE_SERVICE_ROLE_KEY en el servidor)",
          });
        }
        return json(500, { error: "DB write failed", details: msg });
      }
    }

    return json(200, { ok: true, removedFiles: (files ?? []).length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[api/client-documents/[docId]/delete]", msg);
    return json(500, { error: "Server error", details: msg });
  }
}

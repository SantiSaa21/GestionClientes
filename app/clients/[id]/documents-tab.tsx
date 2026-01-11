"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { DocumentNotesModal } from "@/app/ui/document-notes-modal";
import { Modal } from "@/components/ui/modal";

type ClientDocumentRow = {
  id: string;
  client_id: string;
  document_type_id: string | null;
  custom_name: string | null;
  notes: string | null;
  deleted_at: string | null;
  document_types?:
    | {
    id: string;
    name: string;
    code: string;
    required: boolean;
    sort_order: number;
    is_default: boolean;
    is_active: boolean;
    deleted_at: string | null;
    }
    | {
        id: string;
        name: string;
        code: string;
        required: boolean;
        sort_order: number;
        is_default: boolean;
        is_active: boolean;
        deleted_at: string | null;
      }[]
    | null;
};

type FileRow = {
  id: string;
  client_id: string;
  client_document_id: string;
  storage_provider?: string;
  bucket: string;
  path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  deleted_at: string | null;
};

type DocumentTypeRow = {
  id: string;
  name: string;
  code: string;
  sort_order: number;
  is_active: boolean;
  deleted_at: string | null;
};

export function DocumentsTab(props: { clientId: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowser(), []);

  const allowlist = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const isUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [docs, setDocs] = useState<ClientDocumentRow[]>([]);
  const [docTypes, setDocTypes] = useState<DocumentTypeRow[]>([]);
  const [filesByDoc, setFilesByDoc] = useState<Record<string, FileRow[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDoc, setNotesDoc] = useState<ClientDocumentRow | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addAlias, setAddAlias] = useState("");
  const [adding, setAdding] = useState(false);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    fileId: string;
    docId: string;
    fileName: string;
    docName: string;
  } | null>(null);

  const [confirmDeleteDocOpen, setConfirmDeleteDocOpen] = useState(false);
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<{
    docId: string;
    title: string;
    subtitle: string | null;
    fileCount: number;
  } | null>(null);

  const sharedPickerRef = useRef<HTMLInputElement | null>(null);
  const [pickTarget, setPickTarget] = useState<ClientDocumentRow | null>(null);

  async function ensureSessionOrRedirect() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      router.replace("/login");
      return false;
    }

    if (!isUuid(props.clientId)) {
      router.replace("/clients");
      return false;
    }

    if (allowlist.length > 0) {
      const { data: userData } = await supabase.auth.getUser();
      const email = (userData.user?.email ?? "").toLowerCase();
      if (!email || !allowlist.includes(email)) {
        await supabase.auth.signOut();
        router.replace("/login");
        return false;
      }
    }

    return true;
  }

  async function getAccessTokenOrRedirect() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      router.replace("/login");
      return null;
    }
    return data.session.access_token;
  }

  async function load() {
    setLoading(true);
    setError(null);

    const ok = await ensureSessionOrRedirect();
    if (!ok) return;

    // 0) Traer tipos (para encontrar "Otros" y ordenar)
    const { data: typeRows, error: typeErr } = await supabase
      .from("document_types")
      .select("id, name, code, sort_order, is_active, deleted_at")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (typeErr) {
      setError("No se pudieron cargar los tipos de documento.");
      setLoading(false);
      return;
    }

    setDocTypes((typeRows ?? []) as DocumentTypeRow[]);

    // 1) Traer documentos del cliente
    const { data: docRows, error: docErr } = await supabase
      .from("client_documents")
      .select(
        `
        id,
        client_id,
        document_type_id,
        custom_name,
        notes,
        deleted_at,
        document_types (
          id, name, code, required, sort_order, is_default, is_active, deleted_at
        )
      `
      )
      .eq("client_id", props.clientId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (docErr) {
      setError("No se pudieron cargar los documentos.");
      setLoading(false);
      return;
    }

    const safeDocs = (docRows ?? []) as ClientDocumentRow[];

    const otrosSortOrder = (typeRows ?? []).find((t) => (t.name ?? "").trim().toLowerCase() === "otros")?.sort_order;

    // Orden: por sort_order (si hay tipo) y luego por nombre
    const sorted = [...safeDocs].sort((a, b) => {
      const aDt = Array.isArray(a.document_types)
        ? a.document_types[0]
        : a.document_types;
      const bDt = Array.isArray(b.document_types)
        ? b.document_types[0]
        : b.document_types;

      const aOrder = aDt?.sort_order ?? (a.custom_name ? (otrosSortOrder ?? 9999) : 9999);
      const bOrder = bDt?.sort_order ?? (b.custom_name ? (otrosSortOrder ?? 9999) : 9999);
      if (aOrder !== bOrder) return aOrder - bOrder;

      const aName = (a.custom_name ?? aDt?.name ?? "").toLowerCase();
      const bName = (b.custom_name ?? bDt?.name ?? "").toLowerCase();
      return aName.localeCompare(bName);
    });

    setDocs(sorted);

    // 2) Traer todos los archivos de una vez (evita N+1)
    const docIds = sorted.map((d) => d.id);
    if (docIds.length === 0) {
      setFilesByDoc({});
      setLoading(false);
      return;
    }

    const { data: fileRows, error: filesErr } = await supabase
      .from("files")
      .select(
        "id, client_id, client_document_id, bucket, path, original_name, mime_type, size_bytes, created_at, deleted_at"
      )
      .eq("client_id", props.clientId)
      .in("client_document_id", docIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (filesErr) {
      setError("No se pudieron cargar los archivos.");
      setFilesByDoc({});
      setLoading(false);
      return;
    }

    const grouped: Record<string, FileRow[]> = {};
    for (const id of docIds) grouped[id] = [];
    for (const f of (fileRows ?? []) as FileRow[]) {
      if (!grouped[f.client_document_id]) grouped[f.client_document_id] = [];
      grouped[f.client_document_id].push(f);
    }

    setFilesByDoc(grouped);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.clientId]);

  function docDisplayName(d: ClientDocumentRow) {
    const dt = Array.isArray(d.document_types)
      ? d.document_types[0]
      : d.document_types;

    // Título principal: siempre el tipo (ej: "Otros")
    return dt?.name ?? "Otros";
  }

  function docSubtitle(d: ClientDocumentRow) {
    const dt = Array.isArray(d.document_types)
      ? d.document_types[0]
      : d.document_types;

    // Para "Otros" (o documentos personalizados), mostramos el alias debajo como subtítulo
    if (((dt?.name ?? "").toLowerCase() === "otros" || !dt) && d.custom_name) return d.custom_name;
    return null;
  }

  function isRequired(d: ClientDocumentRow) {
    const dt = Array.isArray(d.document_types)
      ? d.document_types[0]
      : d.document_types;

    return !!dt?.required;
  }

  function docTypeLabel(d: ClientDocumentRow) {
    const dt = Array.isArray(d.document_types)
      ? d.document_types[0]
      : d.document_types;
    return dt?.name ?? "Otros";
  }

  function canDeleteDocument(d: ClientDocumentRow) {
    // Solo permitimos borrar documentos "Otros" personalizados (alias) para evitar eliminar
    // documentos predefinidos/requeridos por error.
    return !d.document_type_id && !!d.custom_name;
  }

  async function uploadForDocument(doc: ClientDocumentRow, fileList: File[]) {
    setSavingId(doc.id);
    setError(null);

    try {
      const ok = await ensureSessionOrRedirect();
      if (!ok) return;

      // 1) Subir a Storage
      const bucket = "client-files";

      for (const file of fileList) {
        const safeName = file.name.replace(/[^\w.\-()\s]/g, "_");
        const path = `${props.clientId}/${doc.id}/${crypto.randomUUID()}-${safeName}`;

        const { error: upErr } = await supabase.storage
          .from(bucket)
          .upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type || undefined,
          });

        if (upErr) {
          const msg =
            upErr && typeof upErr === "object" && "message" in upErr
              ? String((upErr as { message?: unknown }).message ?? "")
              : "";
          if (msg.toLowerCase().includes("bucket") && msg.toLowerCase().includes("not found")) {
            setError("No existe el bucket 'client-files' en Storage.");
          } else {
            setError(`No se pudo subir el archivo. Storage: ${msg || "revisa permisos/policies."}`);
          }
          return;
        }

        // 2) Insertar metadatos del archivo (NO reemplazamos: varios archivos por documento)
        const { data: ins, error: insErr } = await supabase
          .from("files")
          .insert({
            client_id: props.clientId,
            client_document_id: doc.id,
            storage_provider: "supabase",
            bucket,
            path,
            original_name: file.name,
            mime_type: file.type || "application/octet-stream",
            size_bytes: file.size,
          })
          .select(
            "id, client_id, client_document_id, bucket, path, original_name, mime_type, size_bytes, created_at, deleted_at"
          )
          .single();

        if (insErr || !ins) {
          setError("Se subió el archivo, pero falló guardar el registro en la base de datos.");
          return;
        }

        // 3) Refrescar estado local (agrega al inicio)
        setFilesByDoc((prev) => {
          const next = { ...prev };
          const current = next[doc.id] ?? [];
          next[doc.id] = [ins as FileRow, ...current];
          return next;
        });
      }
    } finally {
      setSavingId(null);
    }
  }

  function openFileViewer(fileId: string) {
    router.push(`/clients/${props.clientId}/files/${fileId}?tab=documentos`);
  }

  async function deleteFile(fileId: string, docId: string) {
    setSavingId(docId);
    setError(null);
    try {
      const token = await getAccessTokenOrRedirect();
      if (!token) return false;

      const res = await fetch(`/api/files/${fileId}/delete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId: props.clientId }),
      });

      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        let msg = "Error desconocido";
        try {
          const payload = JSON.parse(raw) as { error?: string; details?: string };
          msg = payload?.details || payload?.error || msg;
        } catch {
          msg = raw || msg;
        }
        setError(`No se pudo eliminar el archivo: ${msg}`);
        return false;
      }

      setFilesByDoc((prev) => {
        const next = { ...prev };
        next[docId] = (next[docId] ?? []).filter((f) => f.id !== fileId);
        return next;
      });

      return true;
    } finally {
      setSavingId(null);
    }
  }

  async function deleteDocument(docId: string) {
    setSavingId(docId);
    setError(null);
    try {
      const token = await getAccessTokenOrRedirect();
      if (!token) return false;

      const res = await fetch(`/api/client-documents/${docId}/delete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId: props.clientId }),
      });

      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        let msg = "Error desconocido";
        try {
          const payload = JSON.parse(raw) as { error?: string; details?: string };
          msg = payload?.details || payload?.error || msg;
        } catch {
          msg = raw || msg;
        }
        setError(`No se pudo eliminar el documento: ${msg}`);
        return false;
      }

      setDocs((prev) => prev.filter((d) => d.id !== docId));
      setFilesByDoc((prev) => {
        const next = { ...prev };
        delete next[docId];
        return next;
      });
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[docId];
        return next;
      });

      return true;
    } finally {
      setSavingId(null);
    }
  }

  async function saveNotes(docId: string, notes: string) {
    const { error: upErr } = await supabase
      .from("client_documents")
      .update({ notes })
      .eq("id", docId);

    if (upErr) throw upErr;

    setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, notes } : d)));
  }

  async function addCustomDocument() {
    const alias = addAlias.trim().replace(/\s+/g, " ");
    if (!alias) {
      setError("El alias es requerido.");
      return;
    }

    const ok = await ensureSessionOrRedirect();
    if (!ok) return;

    setAdding(true);
    setError(null);
    try {
      const { data, error: insErr } = await supabase
        .from("client_documents")
        .insert({
          client_id: props.clientId,
          // En la BD existe un check constraint que exige que sea tipo O custom, no ambos.
          // Para mantener la semántica "Otros + alias", guardamos como documento personalizado.
          document_type_id: null,
          custom_name: alias,
          notes: null,
        })
        .select(
          `
          id,
          client_id,
          document_type_id,
          custom_name,
          notes,
          deleted_at,
          document_types (
            id, name, code, required, sort_order, is_default, is_active, deleted_at
          )
        `
        )
        .single();

      // Si falla, intentamos reutilizar un registro personalizado vacío (custom_name null).
      if (insErr || !data) {
        const msg = String(insErr?.message ?? "");

        setError(`No se pudo añadir el documento. ${msg ? `Detalle: ${msg}` : ""}`.trim());
        return;
      }

      setAddOpen(false);
      setAddAlias("");
      setDocs((prev) => {
        const next = [...prev, data as ClientDocumentRow];
        const otrosSortOrder = docTypes.find((t) => (t.name ?? "").trim().toLowerCase() === "otros")?.sort_order;
        return next.sort((a, b) => {
          const aDt = Array.isArray(a.document_types)
            ? a.document_types[0]
            : a.document_types;
          const bDt = Array.isArray(b.document_types)
            ? b.document_types[0]
            : b.document_types;

          const aOrder = aDt?.sort_order ?? (a.custom_name ? (otrosSortOrder ?? 9999) : 9999);
          const bOrder = bDt?.sort_order ?? (b.custom_name ? (otrosSortOrder ?? 9999) : 9999);
          if (aOrder !== bOrder) return aOrder - bOrder;

          const aName = (a.custom_name ?? aDt?.name ?? "").toLowerCase();
          const bName = (b.custom_name ?? bDt?.name ?? "").toLowerCase();
          return aName.localeCompare(bName);
        });
      });
      setFilesByDoc((prev) => ({ ...prev, [data.id]: [] }));
    } finally {
      setAdding(false);
    }
  }

  if (loading) return <div className="card"><div className="cardBody">Cargando documentos...</div></div>;

  return (
    <>
      {error ? <div className="errorText" style={{ marginBottom: 10 }}>{error}</div> : null}

      <div className="card">
        <div className="cardHeader">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div className="title">Documentos del cliente</div>
              <div className="subtitle">Sube varios archivos por documento. Añade notas cuando falte algo.</div>
            </div>
            <button className="btn btnPrimary btnMobileFull" type="button" onClick={() => setAddOpen(true)}>
              Añadir documento
            </button>
          </div>
        </div>

        <div className="cardBody" style={{ paddingTop: 10 }}>
          <input
            ref={sharedPickerRef}
            type="file"
            multiple
            accept="application/pdf,image/*"
            style={{ display: "none" }}
            onChange={async (e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              const doc = pickTarget;
              setPickTarget(null);
              if (!doc || picked.length === 0) return;
              await uploadForDocument(doc, picked);
            }}
          />

          {/* Desktop: tabla */}
          <div className="listDesktop">
            <table className="table">
              <thead>
                <tr>
                  <th className="th">Documento</th>
                  <th className="th">Estado</th>
                  <th className="th" style={{ width: 380 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const list = filesByDoc[d.id] ?? [];
                  const uploaded = list.length > 0;
                  const status = uploaded ? `Subido (${list.length})` : "Pendiente";
                  const isOpen = !!expanded[d.id];

                  return (
                    <tr key={d.id} className="trHover">
                      <td className="td" style={{ fontWeight: 800 }}>
                        <div>{docDisplayName(d)}</div>
                        {docSubtitle(d) ? (
                          <div className="help" style={{ marginTop: 4, marginBottom: 0 }}>
                            {docSubtitle(d)}
                          </div>
                        ) : null}
                        {isRequired(d) ? (
                          <span className="badge" style={{ marginLeft: 10 }}>Requerido</span>
                        ) : null}

                        {(docTypeLabel(d) && docTypeLabel(d).toLowerCase() !== docDisplayName(d).toLowerCase()) ? (
                          <span className="badge" style={{ marginLeft: 10, opacity: 0.85 }}>
                            {docTypeLabel(d)}
                          </span>
                        ) : null}
                      </td>

                      <td className="td">
                        <span className="badge" style={{ borderColor: uploaded ? "rgba(22,163,74,0.3)" : "rgba(217,119,6,0.35)" }}>
                          {status}
                        </span>
                      </td>

                      <td className="td">
                        <div className="row" style={{ justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                          <button
                            className="btn"
                            type="button"
                            disabled={savingId === d.id}
                            onClick={() => {
                              setPickTarget(d);
                              sharedPickerRef.current?.click();
                            }}
                          >
                            {uploaded ? "Añadir archivos" : "Subir"}
                          </button>

                          <button
                            className="btn"
                            type="button"
                            disabled={!uploaded}
                            onClick={() => {
                              setExpanded((prev) => ({ ...prev, [d.id]: !prev[d.id] }));
                            }}
                          >
                            {isOpen ? "Ocultar" : "Ver"}
                          </button>

                          <button
                            className="btn"
                            type="button"
                            onClick={() => {
                              setNotesDoc(d);
                              setNotesOpen(true);
                            }}
                          >
                            Notas
                          </button>

                          {canDeleteDocument(d) ? (
                            <button
                              className="btn btnDangerHover"
                              type="button"
                              disabled={savingId === d.id}
                              onClick={() => {
                                setConfirmDeleteDoc({
                                  docId: d.id,
                                  title: docDisplayName(d),
                                  subtitle: docSubtitle(d),
                                  fileCount: (filesByDoc[d.id] ?? []).length,
                                });
                                setConfirmDeleteDocOpen(true);
                              }}
                            >
                              Eliminar documento
                            </button>
                          ) : null}
                        </div>

                        {uploaded && isOpen ? (
                          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                            <div className="help">Archivos ({list.length})</div>
                            <div style={{ display: "grid", gap: 8 }}>
                              {list.map((f) => (
                                <div
                                  key={f.id}
                                  className="row"
                                  style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}
                                >
                                  <div className="help" style={{ margin: 0 }}>
                                    <b>{f.original_name}</b> · {new Date(f.created_at).toLocaleString("es-BO")}
                                  </div>

                                  <div className="row" style={{ gap: 8 }}>
                                    <button className="btn" type="button" onClick={() => openFileViewer(f.id)}>
                                      Ver archivo
                                    </button>
                                    <button
                                      className="btn btnDangerHover"
                                      type="button"
                                      disabled={savingId === d.id}
                                      onClick={() => {
                                        setConfirmDelete({
                                          fileId: f.id,
                                          docId: d.id,
                                          fileName: f.original_name,
                                          docName: docDisplayName(d),
                                        });
                                        setConfirmDeleteOpen(true);
                                      }}
                                    >
                                      Eliminar
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}

                {docs.length === 0 ? (
                  <tr>
                    <td className="td" colSpan={3}>
                      No hay documentos configurados para este cliente.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="listMobile">
            <div style={{ display: "grid", gap: 12 }}>
              {docs.map((d) => {
                const list = filesByDoc[d.id] ?? [];
                const uploaded = list.length > 0;
                const status = uploaded ? `Subido (${list.length})` : "Pendiente";
                const isOpen = !!expanded[d.id];

                return (
                  <div
                    key={d.id}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 14,
                      padding: 12,
                      background: "#fff",
                      boxShadow: "0 10px 22px rgba(2, 12, 27, 0.06)",
                    }}
                  >
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ fontWeight: 900, fontSize: 16, lineHeight: 1.2 }}>{docDisplayName(d)}</div>
                      {docSubtitle(d) ? (
                        <div className="help" style={{ margin: 0 }}>{docSubtitle(d)}</div>
                      ) : null}

                      <div className="row" style={{ justifyContent: "flex-start", gap: 8, flexWrap: "wrap" }}>
                        {isRequired(d) ? <span className="badge">Requerido</span> : null}
                        {(docTypeLabel(d) && docTypeLabel(d).toLowerCase() !== docDisplayName(d).toLowerCase()) ? (
                          <span className="badge" style={{ opacity: 0.85 }}>{docTypeLabel(d)}</span>
                        ) : null}
                        <span
                          className="badge"
                          style={{
                            borderColor: uploaded ? "rgba(22,163,74,0.3)" : "rgba(217,119,6,0.35)",
                            background: uploaded ? "rgba(22,163,74,0.06)" : "rgba(217,119,6,0.06)",
                            color: uploaded ? "#0f7a31" : "#8b4f06",
                          }}
                        >
                          {status}
                        </span>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <button
                          className="btn"
                          type="button"
                          disabled={savingId === d.id}
                          onClick={() => {
                            setPickTarget(d);
                            sharedPickerRef.current?.click();
                          }}
                        >
                          {uploaded ? "Añadir" : "Subir"}
                        </button>

                        <button
                          className="btn"
                          type="button"
                          disabled={!uploaded}
                          onClick={() => {
                            setExpanded((prev) => ({ ...prev, [d.id]: !prev[d.id] }));
                          }}
                        >
                          {isOpen ? "Ocultar" : "Ver"}
                        </button>

                        <button
                          className="btn"
                          type="button"
                          style={{ gridColumn: "1 / -1" }}
                          onClick={() => {
                            setNotesDoc(d);
                            setNotesOpen(true);
                          }}
                        >
                          Notas
                        </button>

                        {canDeleteDocument(d) ? (
                          <button
                            className="btn btnDangerHover"
                            type="button"
                            style={{ gridColumn: "1 / -1" }}
                            disabled={savingId === d.id}
                            onClick={() => {
                              setConfirmDeleteDoc({
                                docId: d.id,
                                title: docDisplayName(d),
                                subtitle: docSubtitle(d),
                                fileCount: (filesByDoc[d.id] ?? []).length,
                              });
                              setConfirmDeleteDocOpen(true);
                            }}
                          >
                            Eliminar documento
                          </button>
                        ) : null}
                      </div>

                      {uploaded && isOpen ? (
                        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                          <div className="help">Archivos ({list.length})</div>
                          <div style={{ display: "grid", gap: 10 }}>
                            {list.map((f) => (
                              <div
                                key={f.id}
                                style={{
                                  border: "1px solid var(--border)",
                                  borderRadius: 12,
                                  padding: 10,
                                  background: "rgba(29, 78, 216, 0.03)",
                                }}
                              >
                                <div className="help" style={{ margin: 0 }}>
                                  <b>{f.original_name}</b>
                                </div>
                                <div className="help" style={{ marginTop: 4 }}>
                                  {new Date(f.created_at).toLocaleString("es-BO")}
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                                  <button className="btn" type="button" onClick={() => openFileViewer(f.id)}>
                                    Ver
                                  </button>
                                  <button
                                    className="btn btnDangerHover"
                                    type="button"
                                    disabled={savingId === d.id}
                                    onClick={() => {
                                      setConfirmDelete({
                                        fileId: f.id,
                                        docId: d.id,
                                        fileName: f.original_name,
                                        docName: docDisplayName(d),
                                      });
                                      setConfirmDeleteOpen(true);
                                    }}
                                  >
                                    Eliminar
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {docs.length === 0 ? (
                <div className="help">No hay documentos configurados para este cliente.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <DocumentNotesModal
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        title={notesDoc ? `Notas — ${docDisplayName(notesDoc)}` : "Notas"}
        initialNotes={notesDoc?.notes ?? ""}
        onSave={async (val) => {
          if (!notesDoc) return;
          await saveNotes(notesDoc.id, val);
        }}
      />

      <Modal title="Añadir documento (Otros)" open={addOpen} onClose={() => setAddOpen(false)}>
        <div style={{ display: "grid", gap: 12 }}>
          <div className="help" style={{ margin: 0 }}>
            Se añadirá dentro de la categoría <b>Otros</b>. El alias solo cambia el nombre mostrado.
          </div>

          <div className="field">
            <div className="label">Alias</div>
            <input
              className="input"
              placeholder="Ej: Certificado de domicilio"
              value={addAlias}
              onChange={(e) => setAddAlias(e.target.value)}
            />
          </div>

          <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
            <button className="btn" type="button" onClick={() => setAddOpen(false)} disabled={adding}>
              Cancelar
            </button>
            <button className="btn btnPrimary" type="button" onClick={addCustomDocument} disabled={adding}>
              {adding ? "Añadiendo..." : "Añadir"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        title="Confirmar eliminación"
        open={confirmDeleteOpen}
        onClose={() => {
          if (savingId) return;
          setConfirmDeleteOpen(false);
          setConfirmDelete(null);
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div className="help" style={{ margin: 0 }}>
            Vas a eliminar este archivo del documento <b>{confirmDelete?.docName ?? ""}</b>.
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 12,
              background: "rgba(239, 68, 68, 0.04)",
            }}
          >
            <div style={{ fontWeight: 900, lineHeight: 1.2 }}>{confirmDelete?.fileName ?? ""}</div>
            <div className="help" style={{ marginTop: 6 }}>
              Esta acción es permanente y liberará espacio en Storage.
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              className="btn"
              type="button"
              disabled={!!savingId}
              onClick={() => {
                setConfirmDeleteOpen(false);
                setConfirmDelete(null);
              }}
            >
              Cancelar
            </button>

            <button
              className="btn btnDangerHover"
              type="button"
              disabled={!!savingId || !confirmDelete}
              onClick={async () => {
                if (!confirmDelete) return;
                const ok = await deleteFile(confirmDelete.fileId, confirmDelete.docId);
                if (ok) {
                  setConfirmDeleteOpen(false);
                  setConfirmDelete(null);
                }
              }}
            >
              {savingId ? "Eliminando..." : "Eliminar"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        title="Confirmar eliminación de documento"
        open={confirmDeleteDocOpen}
        onClose={() => {
          if (savingId) return;
          setConfirmDeleteDocOpen(false);
          setConfirmDeleteDoc(null);
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div className="help" style={{ margin: 0 }}>
            Vas a eliminar este documento. Si tiene archivos, también se eliminarán y se liberará espacio en Storage.
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 12,
              background: "rgba(239, 68, 68, 0.04)",
            }}
          >
            <div style={{ fontWeight: 900, lineHeight: 1.2 }}>{confirmDeleteDoc?.title ?? ""}</div>
            {confirmDeleteDoc?.subtitle ? (
              <div className="help" style={{ marginTop: 6 }}>{confirmDeleteDoc.subtitle}</div>
            ) : null}
            <div className="help" style={{ marginTop: 6 }}>
              Archivos: <b>{confirmDeleteDoc?.fileCount ?? 0}</b>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              className="btn"
              type="button"
              disabled={!!savingId}
              onClick={() => {
                setConfirmDeleteDocOpen(false);
                setConfirmDeleteDoc(null);
              }}
            >
              Cancelar
            </button>

            <button
              className="btn btnDangerHover"
              type="button"
              disabled={!!savingId || !confirmDeleteDoc}
              onClick={async () => {
                if (!confirmDeleteDoc) return;
                const ok = await deleteDocument(confirmDeleteDoc.docId);
                if (ok) {
                  setConfirmDeleteDocOpen(false);
                  setConfirmDeleteDoc(null);
                }
              }}
            >
              {savingId ? "Eliminando..." : "Eliminar"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

type FileRow = {
  id: string;
  client_id: string;
  client_document_id: string;
  bucket: string;
  path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  deleted_at: string | null;
};

export default function ClientFileViewerPage() {
  const router = useRouter();
  const params = useParams<{ id: string; fileId: string }>();
  const searchParams = useSearchParams();

  const supabase = useMemo(() => createSupabaseBrowser(), []);

  const clientId = params.id;
  const fileId = params.fileId;

  const allowlist = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const isUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

  const backTab = (searchParams.get("tab") ?? "documentos").toLowerCase();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<FileRow | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const [zoom, setZoom] = useState(110); // percent
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pinchRef = useRef<{ startDistance: number; startZoom: number } | null>(null);
  const imageMetaRef = useRef<{ naturalWidth: number; naturalHeight: number } | null>(null);
  const didAutoFitRef = useRef(false);

  const clampZoom = (value: number) => Math.max(10, Math.min(300, Math.round(value)));

  const isPdf = useMemo(() => {
    if (!file) return false;
    const name = (file.original_name ?? "").toLowerCase();
    return file.mime_type === "application/pdf" || name.endsWith(".pdf");
  }, [file]);

  const isImage = useMemo(() => {
    if (!file) return false;
    return (file.mime_type ?? "").startsWith("image/");
  }, [file]);

  function fitImageToWidth() {
    const viewport = viewportRef.current;
    const meta = imageMetaRef.current;
    if (!viewport || !meta?.naturalWidth) return;
    // Account for small padding around content.
    const availableWidth = Math.max(1, viewport.clientWidth - 24);
    const next = (availableWidth / meta.naturalWidth) * 100;
    setZoom(clampZoom(next));
  }

  async function ensureSessionOrRedirect() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      router.replace("/login");
      return false;
    }

    if (!isUuid(clientId) || !isUuid(fileId)) {
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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const ok = await ensureSessionOrRedirect();
      if (!ok) return;

      const { data, error } = await supabase
        .from("files")
        .select(
          "id, client_id, client_document_id, bucket, path, original_name, mime_type, size_bytes, created_at, deleted_at"
        )
        .eq("id", fileId)
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        setError("No se pudo cargar el archivo.");
        setFile(null);
        setSignedUrl(null);
        setLoading(false);
        return;
      }

      const row = data as FileRow;
      setFile(row);

      const { data: urlData, error: urlErr } = await supabase.storage
        .from(row.bucket)
        .createSignedUrl(row.path, 60 * 5);

      if (cancelled) return;

      if (urlErr || !urlData?.signedUrl) {
        setError("No se pudo generar el enlace del archivo.");
        setSignedUrl(null);
        setLoading(false);
        return;
      }

      setSignedUrl(urlData.signedUrl);
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, fileId]);

  // Mobile pinch-to-zoom (images only): allow single-finger scroll, intercept only 2-finger pinch.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    if (!isImage) return;

    function distance(t1: Touch, t2: Touch) {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.hypot(dx, dy);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        pinchRef.current = {
          startDistance: distance(e.touches[0], e.touches[1]),
          startZoom: zoom,
        };
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2) return;
      const pinch = pinchRef.current;
      if (!pinch) return;
      // Prevent browser page zoom when pinching inside the viewer.
      e.preventDefault();
      const d = distance(e.touches[0], e.touches[1]);
      if (!pinch.startDistance) return;
      const next = (pinch.startZoom * d) / pinch.startDistance;
      setZoom(clampZoom(next));
    }

    function onTouchEnd() {
      if (pinchRef.current) pinchRef.current = null;
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
    // Intentionally depend on isImage and zoom so gesture uses latest zoom baseline.
  }, [isImage, zoom]);

  function backToClient() {
    router.push(`/clients/${clientId}?tab=${encodeURIComponent(backTab)}`);
  }

  if (loading) {
    return (
      <main className="card">
        <div className="cardBody">Cargando archivo...</div>
      </main>
    );
  }

  return (
    <main>
      <div className="row" style={{ marginBottom: 12, alignItems: "flex-start" }}>
        <div>
          <h1 className="title" style={{ marginBottom: 2 }}>
            {file?.original_name ?? "Archivo"}
          </h1>
          <div className="help">
            {file ? new Date(file.created_at).toLocaleString("es-BO") : null}
          </div>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={backToClient}>
            Volver
          </button>

          {signedUrl ? (
            <a className="btn btnOutlinePrimary" href={signedUrl} target="_blank" rel="noreferrer">
              Abrir en nueva pestaña
            </a>
          ) : null}
        </div>
      </div>

      {error ? <div className="errorText" style={{ marginBottom: 10 }}>{error}</div> : null}

      {!file || !signedUrl ? (
        <section className="card">
          <div className="cardBody">No hay archivo para mostrar.</div>
        </section>
      ) : (
        <section className="card">
          <div className="cardBody" style={{ display: "grid", gap: 10 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div className="help" style={{ margin: 0 }}>
                Zoom: <b>{zoom}%</b>
              </div>

              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {isImage ? (
                  <button className="btn" type="button" onClick={fitImageToWidth}>
                    Ajustar
                  </button>
                ) : null}

                <button className="btn" type="button" onClick={() => setZoom((z) => clampZoom(z - 10))}>
                  -
                </button>
                <button className="btn" type="button" onClick={() => setZoom(110)}>
                  Reset
                </button>
                <button className="btn" type="button" onClick={() => setZoom((z) => clampZoom(z + 10))}>
                  +
                </button>
              </div>
            </div>

            {isImage ? (
              <div
                ref={viewportRef}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "auto",
                  background: "#fff",
                  height: "70vh",
                  touchAction: "pan-x pan-y",
                }}
              >
                <div style={{ padding: 12 }}>
                  <img
                    src={signedUrl}
                    alt={file.original_name}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      imageMetaRef.current = {
                        naturalWidth: img.naturalWidth,
                        naturalHeight: img.naturalHeight,
                      };
                      // On first load, if the image is wider than the viewport, fit it.
                      // This avoids the "can't see full document" issue on mobile.
                      if (didAutoFitRef.current) return;
                      const viewport = viewportRef.current;
                      if (!viewport) return;
                      const availableWidth = Math.max(1, viewport.clientWidth - 24);
                      if (img.naturalWidth > availableWidth) {
                        didAutoFitRef.current = true;
                        fitImageToWidth();
                      }
                    }}
                    style={{
                      transform: `scale(${zoom / 100})`,
                      transformOrigin: "top left",
                      display: "block",
                      maxWidth: "none",
                    }}
                  />
                </div>
              </div>
            ) : isPdf ? (
              <div
                ref={viewportRef}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "#fff",
                  height: "70vh",
                }}
              >
                <object
                  aria-label={file.original_name}
                  data={`${signedUrl}#zoom=${zoom}`}
                  type="application/pdf"
                  style={{ width: "100%", height: "100%", border: 0 }}
                >
                  <div className="help" style={{ padding: 12 }}>
                    Tu navegador no pudo mostrar el PDF aquí. Usa “Abrir en nueva pestaña”.
                  </div>
                </object>
              </div>
            ) : (
              <div className="help">
                Vista previa no disponible para este tipo. Usa “Abrir en nueva pestaña”.
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

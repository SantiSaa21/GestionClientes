"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/browser";
import { ClientList, type ClientRow } from "@/components/clients/client-list";
import { Modal } from "@/components/ui/modal";
import { ClientForm } from "@/components/clients/client-form";

const PAGE_SIZE = 10;

export default function ClientsPage() {
  const router = useRouter();

  const allowlist = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [openNew, setOpenNew] = useState(false);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  async function ensureSessionOrRedirect() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      router.replace("/login");
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

  async function loadClients(opts?: { page?: number; query?: string }) {
    setLoading(true);
    setError(null);

    const ok = await ensureSessionOrRedirect();
    if (!ok) return;

    const currentPage = opts?.page ?? page;
    const currentQuery = (opts?.query ?? query).trim();

    const from = (currentPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("clients")
      .select("id, full_name, phone", { count: "exact" })
      .is("deleted_at", null);

    if (currentQuery) {
      // Busca por nombre o por celular
      q = q.or(`full_name.ilike.%${currentQuery}%,phone.ilike.%${currentQuery}%`);
    }

    const { data, error, count } = await q
      .order("full_name", { ascending: true })
      .range(from, to);

    if (error) {
      setError("No se pudo cargar la lista de clientes.");
      setClients([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setClients((data ?? []) as ClientRow[]);
    setTotal(count ?? 0);
    setLoading(false);
  }

  // Primera carga
  useEffect(() => {
    loadClients({ page: 1, query: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Buscador dinámico con debounce
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      loadClients({ page: 1, query });
    }, 250);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Cambio de página
  useEffect(() => {
    loadClients({ page, query });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return (
    <main>
      <div className="row" style={{ marginBottom: 12, alignItems: "flex-start" }}>
        <div>
          <h1 className="title">Clientes</h1>
          <p className="subtitle">Busca por nombre o celular</p>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <button className="btn btnDangerHover" onClick={async () => {
            await supabase.auth.signOut();
            router.replace("/login");
          }}>
            Cerrar sesión
          </button>
        </div>
      </div>

      {/* Barra superior: buscador + nuevo */}
      <section className="card" style={{ marginTop: 12 }}>
        <div className="cardBody" style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "1fr 160px",
            }}
          >
            <div className="field">
              <div className="label">Buscar</div>
              <input
                className="input"
                placeholder="Ej: Santiago o 69503355"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="help">
                Mostrando {clients.length} de {total} resultados
              </div>
            </div>

            <div style={{ display: "grid", alignContent: "end" }}>
              <button className="btn btnPrimary" onClick={() => setOpenNew(true)}>
                Añadir cliente
              </button>
            </div>
          </div>

          {error && <div className="errorText">{error}</div>}
        </div>
      </section>

      {/* Lista */}
      {loading ? (
        <p style={{ marginTop: 12 }}>Cargando...</p>
      ) : (
        <ClientList clients={clients} onView={(id) => router.push(`/clients/${id}`)} />
      )}

      {/* Paginación */}
      <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <div className="subtitle" style={{ margin: 0 }}>
          Página {page} de {pageCount}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </button>

          <button
            className="btn"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Siguiente
          </button>
        </div>
      </div>

      {/* Modal Nuevo Cliente */}
      <Modal title="Añadir cliente" open={openNew} onClose={() => setOpenNew(false)}>
        <ClientForm
          onCreate={async (input) => {
            setError(null);

            const ok = await ensureSessionOrRedirect();
            if (!ok) return;

            const { error } = await supabase.from("clients").insert(input);

            if (error) {
              setError("No se pudo guardar el cliente. Revisa si el celular ya existe.");
              return;
            }

            setOpenNew(false);
            setPage(1);
            await loadClients({ page: 1, query });
          }}
        />
      </Modal>
    </main>
  );
}

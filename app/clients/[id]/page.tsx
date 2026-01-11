"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/browser";
import { DocumentsTab } from "./documents-tab";
import { Modal } from "@/components/ui/modal";
import { normalizeFullName } from "@/lib/text";

type Client = {
  id: string;
  full_name: string;
  phone: string;
  ci: string | null;
  birth_date: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  total_amount: number | null;
  created_at: string;
};

type ClientOwnership = {
  id: string;
  client_id: string;
  owner_name: string;
  start_year: number | null;
  end_year: number | null;
  is_current: boolean;
  notes: string | null;
  created_at: string;
  deleted_at: string | null;
};

type ClientPayment = {
  id: string;
  client_id: string;
  amount: number | string;
  paid_at: string;
  notes: string | null;
  created_at: string;
  deleted_at: string | null;
};

function asNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseMoney(input: string): number | null {
  const raw = input.trim();
  if (!raw) return null;

  const normalized = raw.replace(/\s+/g, "").replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function formatMoneyBOB(n: number) {
  try {
    return new Intl.NumberFormat("es-BO", {
      style: "currency",
      currency: "BOB",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `Bs ${n.toFixed(2)}`;
  }
}

type TabKey = "datos" | "documentos" | "pagos";

export default function ClientDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const clientId = params.id;

  const allowlist = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const isUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editCi, setEditCi] = useState("");
  const [editBirthDate, setEditBirthDate] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [ownershipSupported, setOwnershipSupported] = useState(true);
  const [owners, setOwners] = useState<ClientOwnership[]>([]);
  const [ownersError, setOwnersError] = useState<string | null>(null);

  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerEditId, setOwnerEditId] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [ownerStartYear, setOwnerStartYear] = useState("");
  const [ownerEndYear, setOwnerEndYear] = useState("");
  const [ownerIsCurrent, setOwnerIsCurrent] = useState(true);
  const [ownerNotes, setOwnerNotes] = useState("");
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [ownerFormError, setOwnerFormError] = useState<string | null>(null);

  const [confirmDeleteOwnerOpen, setConfirmDeleteOwnerOpen] = useState(false);
  const [confirmDeleteOwner, setConfirmDeleteOwner] = useState<{ id: string; name: string } | null>(null);

  const [paymentsSupported, setPaymentsSupported] = useState(true);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [payments, setPayments] = useState<ClientPayment[]>([]);

  const [totalOpen, setTotalOpen] = useState(false);
  const [totalInput, setTotalInput] = useState("");
  const [totalSaving, setTotalSaving] = useState(false);
  const [totalError, setTotalError] = useState<string | null>(null);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentEditId, setPaymentEditId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);

  const [confirmDeletePaymentOpen, setConfirmDeletePaymentOpen] = useState(false);
  const [confirmDeletePayment, setConfirmDeletePayment] = useState<{ id: string; label: string } | null>(null);

  const [tab, setTab] = useState<TabKey>("datos");

  const [confirmDeleteClientOpen, setConfirmDeleteClientOpen] = useState(false);
  const [confirmDeleteClient2Open, setConfirmDeleteClient2Open] = useState(false);
  const [confirmDeleteClientText, setConfirmDeleteClientText] = useState("");
  const [deleteClientSaving, setDeleteClientSaving] = useState(false);
  const [deleteClientError, setDeleteClientError] = useState<string | null>(null);

  useEffect(() => {
    const t = (searchParams.get("tab") ?? "").toLowerCase();
    if (t === "datos" || t === "documentos" || t === "pagos") {
      setTab(t);
    }
  }, [searchParams]);

  const title = useMemo(() => {
    if (!client) return "Ficha del cliente";
    return client.full_name;
  }, [client]);

  async function ensureSessionOrRedirect() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      router.replace("/login");
      return false;
    }

    if (!isUuid(clientId)) {
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

  async function deleteClient() {
    setDeleteClientSaving(true);
    setDeleteClientError(null);

    try {
      const token = await getAccessTokenOrRedirect();
      if (!token) return;

      const res = await fetch(`/api/clients/${clientId}/delete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId }),
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
        setDeleteClientError(msg);
        return;
      }

      router.replace("/clients");
    } finally {
      setDeleteClientSaving(false);
    }
  }

  async function loadClient() {
    setLoading(true);
    setError(null);

    const ok = await ensureSessionOrRedirect();
    if (!ok) return;

    // Try extended schema first; fallback if migration wasn't applied yet.
    const extended = await supabase
      .from("clients")
      .select("id, full_name, phone, ci, birth_date, email, address, notes, total_amount, created_at")
      .eq("id", clientId)
      .is("deleted_at", null)
      .maybeSingle();

    if (extended.error) {
      const msg = extended.error.message ?? "";
      if (msg.toLowerCase().includes("column") && msg.toLowerCase().includes("does not exist")) {
        const basic = await supabase
          .from("clients")
          .select("id, full_name, phone, created_at")
          .eq("id", clientId)
          .is("deleted_at", null)
          .maybeSingle();

        if (basic.error || !basic.data) {
          setError("No se pudo cargar la ficha del cliente.");
          setClient(null);
          setLoading(false);
          return;
        }

        setError(
          "La base de datos aún no tiene los nuevos campos (CI/fecha de nacimiento/etc). Ejecuta la migración de supabase/migrations." 
        );

        setClient({
          ...(basic.data as { id: string; full_name: string; phone: string; created_at: string }),
          ci: null,
          birth_date: null,
          email: null,
          address: null,
          notes: null,
          total_amount: null,
        } as Client);
        setLoading(false);
        return;
      }

      setError("No se pudo cargar la ficha del cliente.");
      setClient(null);
      setLoading(false);
      return;
    }

    if (!extended.data) {
      setError("No se pudo cargar la ficha del cliente.");
      setClient(null);
      setLoading(false);
      return;
    }

    // Normalize total_amount to number|null
    const row = extended.data as Client & { total_amount?: unknown };
    setClient({
      ...row,
      total_amount: asNumber((row as { total_amount?: unknown }).total_amount),
    } as Client);
    setLoading(false);
  }

  async function loadOwners() {
    setOwnersError(null);
    setOwnershipSupported(true);

    const ok = await ensureSessionOrRedirect();
    if (!ok) return;

    const { data, error } = await supabase
      .from("client_ownerships")
      .select("id, client_id, owner_name, start_year, end_year, is_current, notes, created_at, deleted_at")
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .order("is_current", { ascending: false })
      .order("start_year", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      const msg = error.message ?? "";
      if (msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("relation")) {
        setOwnershipSupported(false);
        setOwners([]);
        return;
      }
      setOwnersError("No se pudo cargar la tradición (historial de dueños).");
      setOwners([]);
      return;
    }

    setOwners((data ?? []) as ClientOwnership[]);
  }

  async function loadPayments() {
    setPaymentsError(null);
    setPaymentsSupported(true);

    const ok = await ensureSessionOrRedirect();
    if (!ok) return;

    const { data, error } = await supabase
      .from("client_payments")
      .select("id, client_id, amount, paid_at, notes, created_at, deleted_at")
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .order("paid_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      const msg = error.message ?? "";
      if (msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("relation")) {
        setPaymentsSupported(false);
        setPayments([]);
        return;
      }
      setPaymentsError("No se pudieron cargar los pagos.");
      setPayments([]);
      return;
    }

    setPayments((data ?? []) as ClientPayment[]);
  }

  function openEdit() {
    if (!client) return;
    setEditError(null);
    setEditName(client.full_name);
    setEditPhone(client.phone);
    setEditCi(client.ci ?? "");
    setEditBirthDate(client.birth_date ?? "");
    setEditEmail(client.email ?? "");
    setEditAddress(client.address ?? "");
    setEditNotes(client.notes ?? "");
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!client) return;

    const name = normalizeFullName(editName);
    const phone = editPhone.trim();
    const ci = editCi.trim() || null;
    const birth_date = editBirthDate.trim() || null;
    const email = editEmail.trim() || null;
    const address = editAddress.trim() || null;
    const notes = editNotes.trim() || null;

    setEditError(null);

    if (!name) {
      setEditError("El nombre es requerido.");
      return;
    }
    if (!/^\d{8}$/.test(phone)) {
      setEditError("El celular debe tener 8 dígitos (sin +591). ");
      return;
    }

    const ok = await ensureSessionOrRedirect();
    if (!ok) return;

    setEditSaving(true);
    try {
      const { data, error } = await supabase
        .from("clients")
        .update({ full_name: name, phone, ci, birth_date, email, address, notes })
        .eq("id", clientId)
        .select("id, full_name, phone, ci, birth_date, email, address, notes, total_amount, created_at")
        .maybeSingle();

      if (error || !data) {
        setEditError("No se pudo guardar. Revisa si el celular ya existe.");
        return;
      }

      const row = data as Client & { total_amount?: unknown };
      setClient({
        ...row,
        total_amount: asNumber((row as { total_amount?: unknown }).total_amount),
      } as Client);
      setEditOpen(false);

      // Refresh owners in case UI depends on current owner display
      await loadOwners();
    } finally {
      setEditSaving(false);
    }
  }

  function openAddOwner() {
    setOwnerFormError(null);
    setOwnerEditId(null);
    setOwnerName("");
    setOwnerStartYear("");
    setOwnerEndYear("");
    setOwnerIsCurrent(true);
    setOwnerNotes("");
    setOwnerOpen(true);
  }

  function openEditOwner(row: ClientOwnership) {
    setOwnerFormError(null);
    setOwnerEditId(row.id);
    setOwnerName(row.owner_name);
    setOwnerStartYear(row.start_year != null ? String(row.start_year) : "");
    setOwnerEndYear(row.end_year != null ? String(row.end_year) : "");
    setOwnerIsCurrent(!!row.is_current);
    setOwnerNotes(row.notes ?? "");
    setOwnerOpen(true);
  }

  function parseYear(input: string): number | null {
    const v = input.trim();
    if (!v) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const i = Math.trunc(n);
    if (i < 1900 || i > 2100) return null;
    return i;
  }

  async function saveOwner() {
    const name = ownerName.trim().replace(/\s+/g, " ");
    const start_year = parseYear(ownerStartYear);
    const end_year = parseYear(ownerEndYear);
    const notes = ownerNotes.trim() || null;

    setOwnerFormError(null);

    if (!name) {
      setOwnerFormError("El nombre del dueño es requerido.");
      return;
    }

    if (start_year != null && end_year != null && end_year < start_year) {
      setOwnerFormError("El año fin no puede ser menor al año inicio.");
      return;
    }

    const ok = await ensureSessionOrRedirect();
    if (!ok) return;

    setOwnerSaving(true);
    try {
      // If marking as current, unset others first (best-effort)
      if (ownerIsCurrent) {
        const q = supabase
          .from("client_ownerships")
          .update({ is_current: false })
          .eq("client_id", clientId)
          .is("deleted_at", null);

        if (ownerEditId) {
          await q.neq("id", ownerEditId);
        } else {
          await q;
        }
      }

      if (ownerEditId) {
        const { error } = await supabase
          .from("client_ownerships")
          .update({ owner_name: name, start_year, end_year, is_current: ownerIsCurrent, notes })
          .eq("id", ownerEditId)
          .eq("client_id", clientId);

        if (error) {
          setOwnerFormError("No se pudo guardar la tradición.");
          return;
        }
      } else {
        const { error } = await supabase
          .from("client_ownerships")
          .insert({
            client_id: clientId,
            owner_name: name,
            start_year,
            end_year,
            is_current: ownerIsCurrent,
            notes,
          });

        if (error) {
          setOwnerFormError("No se pudo añadir a la tradición.");
          return;
        }
      }

      setOwnerOpen(false);
      await loadOwners();
    } finally {
      setOwnerSaving(false);
    }
  }

  async function deleteOwner(ownerId: string) {
    const ok = await ensureSessionOrRedirect();
    if (!ok) return;

    setOwnerSaving(true);
    try {
      const { error } = await supabase
        .from("client_ownerships")
        .update({ deleted_at: new Date().toISOString(), is_current: false })
        .eq("id", ownerId)
        .eq("client_id", clientId);

      if (error) {
        setOwnersError("No se pudo eliminar el registro de tradición.");
        return;
      }

      await loadOwners();
      setConfirmDeleteOwnerOpen(false);
      setConfirmDeleteOwner(null);
    } finally {
      setOwnerSaving(false);
    }
  }


  useEffect(() => {
    loadClient();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    // Load ownership history separately so it can fail gracefully.
    loadOwners();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const currentOwner = useMemo(() => owners.find((o) => o.is_current) ?? null, [owners]);

  const totalAmount = useMemo(() => client?.total_amount ?? null, [client]);
  const totalPaid = useMemo(() => {
    const sum = payments.reduce((acc, p) => acc + (asNumber(p.amount) ?? 0), 0);
    return Math.round(sum * 100) / 100;
  }, [payments]);
  const remaining = useMemo(() => {
    if (totalAmount == null) return null;
    return Math.round((totalAmount - totalPaid) * 100) / 100;
  }, [totalAmount, totalPaid]);

  function openTotalModal() {
    setTotalError(null);
    setTotalInput(totalAmount != null ? String(totalAmount) : "");
    setTotalOpen(true);
  }

  async function saveTotalAmount() {
    if (!client) return;
    setTotalError(null);

    const val = parseMoney(totalInput);
    if (totalInput.trim() && val == null) {
      setTotalError("Monto total inválido.");
      return;
    }
    if (val != null && val < 0) {
      setTotalError("El monto total no puede ser negativo.");
      return;
    }

    const ok = await ensureSessionOrRedirect();
    if (!ok) return;

    setTotalSaving(true);
    try {
      const { data, error } = await supabase
        .from("clients")
        .update({ total_amount: val })
        .eq("id", clientId)
        .select("id, full_name, phone, ci, birth_date, email, address, notes, total_amount, created_at")
        .maybeSingle();

      if (error || !data) {
        setTotalError("No se pudo guardar el monto total.");
        return;
      }

      const row = data as Client & { total_amount?: unknown };
      setClient({
        ...row,
        total_amount: asNumber((row as { total_amount?: unknown }).total_amount),
      } as Client);
      setTotalOpen(false);
    } finally {
      setTotalSaving(false);
    }
  }

  function openAddPayment() {
    setPaymentFormError(null);
    setPaymentEditId(null);
    setPaymentAmount("");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentNotes("");
    setPaymentOpen(true);
  }

  function openEditPayment(p: ClientPayment) {
    setPaymentFormError(null);
    setPaymentEditId(p.id);
    setPaymentAmount(String(asNumber(p.amount) ?? ""));
    setPaymentDate(p.paid_at ?? new Date().toISOString().slice(0, 10));
    setPaymentNotes(p.notes ?? "");
    setPaymentOpen(true);
  }

  async function savePayment() {
    setPaymentFormError(null);

    const amt = parseMoney(paymentAmount);
    if (amt == null) {
      setPaymentFormError("Monto inválido.");
      return;
    }
    if (amt <= 0) {
      setPaymentFormError("El monto debe ser mayor a 0.");
      return;
    }
    const date = paymentDate.trim();
    if (!date) {
      setPaymentFormError("La fecha es requerida.");
      return;
    }
    const notes = paymentNotes.trim() || null;

    const ok = await ensureSessionOrRedirect();
    if (!ok) return;

    setPaymentSaving(true);
    try {
      if (paymentEditId) {
        const { error } = await supabase
          .from("client_payments")
          .update({ amount: amt, paid_at: date, notes })
          .eq("id", paymentEditId)
          .eq("client_id", clientId);

        if (error) {
          setPaymentFormError("No se pudo guardar el pago.");
          return;
        }
      } else {
        const { error } = await supabase
          .from("client_payments")
          .insert({ client_id: clientId, amount: amt, paid_at: date, notes });

        if (error) {
          setPaymentFormError("No se pudo añadir el pago.");
          return;
        }
      }

      setPaymentOpen(false);
      await loadPayments();
    } finally {
      setPaymentSaving(false);
    }
  }

  async function deletePayment(paymentId: string) {
    const ok = await ensureSessionOrRedirect();
    if (!ok) return;

    setPaymentSaving(true);
    try {
      const { error } = await supabase
        .from("client_payments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", paymentId)
        .eq("client_id", clientId);

      if (error) {
        setPaymentsError("No se pudo eliminar el pago.");
        return;
      }

      await loadPayments();
      setConfirmDeletePaymentOpen(false);
      setConfirmDeletePayment(null);
    } finally {
      setPaymentSaving(false);
    }
  }

  return (
    <main>
      <div className="row" style={{ marginBottom: 12, alignItems: "flex-start" }}>
        <div>
          <h1 className="title">{title}</h1>
          <p className="subtitle">
            {client ? `Celular: ${client.phone}` : "Cargando datos..."}
          </p>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <button className="btn" onClick={() => router.push("/clients")}>
            Volver
          </button>

          <button
            className="btn btnDangerHover"
            type="button"
            onClick={() => {
              setDeleteClientError(null);
              setConfirmDeleteClientText("");
              setConfirmDeleteClientOpen(true);
            }}
          >
            Eliminar cliente
          </button>

          <button
            className="btn btnDangerHover"
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace("/login");
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      {error && <div className="errorText">{error}</div>}
      {deleteClientError ? <div className="errorText" style={{ marginTop: 10 }}>{deleteClientError}</div> : null}

      {loading ? (
        <p style={{ marginTop: 12 }}>Cargando...</p>
      ) : !client ? (
        <p style={{ marginTop: 12 }}>Cliente no encontrado.</p>
      ) : (
        <>
          {/* Tabs */}
          <div
            className="row"
            style={{
              gap: 8,
              justifyContent: "flex-start",
              flexWrap: "wrap",
              marginTop: 8,
            }}
          >
            <button
              className={`btn ${tab === "datos" ? "btnPrimary" : ""}`}
              onClick={() => setTab("datos")}
            >
              Datos
            </button>

            <button
              className={`btn ${tab === "documentos" ? "btnPrimary" : ""}`}
              onClick={() => setTab("documentos")}
            >
              Documentos
            </button>

            <button
              className={`btn ${tab === "pagos" ? "btnPrimary" : ""}`}
              onClick={() => setTab("pagos")}
            >
              Pagos
            </button>
          </div>

          {/* Datos */}
          {tab === "datos" && (
            <>
              <section className="card" style={{ marginTop: 12 }}>
                <div className="cardBody" style={{ display: "grid", gap: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
                    <div>
                      <div className="label">Nombre</div>
                      <div style={{ fontWeight: 900 }}>{client.full_name}</div>
                    </div>

                    <div>
                      <div className="label">Celular</div>
                      <div style={{ fontWeight: 900 }}>{client.phone}</div>
                    </div>

                    <div>
                      <div className="label">CI</div>
                      <div style={{ fontWeight: 900 }}>{client.ci ?? "—"}</div>
                    </div>

                    <div>
                      <div className="label">Fecha de nacimiento</div>
                      <div style={{ fontWeight: 900 }}>
                        {client.birth_date ? new Date(client.birth_date).toLocaleDateString("es-BO") : "—"}
                      </div>
                    </div>

                    <div>
                      <div className="label">Email</div>
                      <div style={{ fontWeight: 900 }}>{client.email ?? "—"}</div>
                    </div>

                    <div>
                      <div className="label">Dirección</div>
                      <div style={{ fontWeight: 900 }}>{client.address ?? "—"}</div>
                    </div>

                    <div>
                      <div className="label">Dueño actual</div>
                      <div style={{ fontWeight: 900 }}>{currentOwner?.owner_name ?? "—"}</div>
                    </div>

                    <div style={{ display: "grid", alignContent: "end" }}>
                      <button className="btn btnPrimary" type="button" onClick={openEdit}>
                        Editar datos
                      </button>
                    </div>
                  </div>

                  {client.notes ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <div className="label">Notas</div>
                      <div className="help" style={{ margin: 0 }}>{client.notes}</div>
                    </div>
                  ) : null}

                  <div className="help">Creado: {new Date(client.created_at).toLocaleString("es-BO")}</div>
                </div>
              </section>

              <section className="card" style={{ marginTop: 12 }}>
                <div className="cardHeader">
                  <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div className="title">Tradición (historial de dueños)</div>
                      <div className="subtitle">Registra quién fue dueño y en qué años.</div>
                    </div>

                    <button
                      className="btn btnPrimary btnMobileFull"
                      type="button"
                      onClick={openAddOwner}
                      disabled={!ownershipSupported}
                    >
                      Añadir dueño
                    </button>
                  </div>
                </div>

                <div className="cardBody" style={{ display: "grid", gap: 10 }}>
                  {!ownershipSupported ? (
                    <div className="errorText">
                      La tabla de tradición no existe todavía. Ejecuta la migración en supabase/migrations.
                    </div>
                  ) : null}

                  {ownersError ? <div className="errorText">{ownersError}</div> : null}

                  {ownershipSupported && owners.length === 0 ? (
                    <div className="help">Aún no hay registros de tradición para este cliente.</div>
                  ) : null}

                  {ownershipSupported && owners.length > 0 ? (
                    <div style={{ display: "grid", gap: 10 }}>
                      {owners.map((o) => {
                        const years =
                          o.start_year != null || o.end_year != null
                            ? `${o.start_year ?? "?"} - ${o.is_current ? "Actual" : o.end_year ?? "?"}`
                            : "Años no especificados";

                        return (
                          <div
                            key={o.id}
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 14,
                              padding: 12,
                              background: "#fff",
                              boxShadow: "0 10px 22px rgba(2, 12, 27, 0.06)",
                              display: "grid",
                              gap: 8,
                            }}
                          >
                            <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                              <div>
                                <div style={{ fontWeight: 900 }}>{o.owner_name}</div>
                                <div className="help" style={{ margin: 0 }}>{years}</div>
                              </div>

                              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                {o.is_current ? <span className="badge">Actual</span> : null}
                                <button className="btn" type="button" onClick={() => openEditOwner(o)}>
                                  Editar
                                </button>
                                <button
                                  className="btn btnDangerHover"
                                  type="button"
                                  disabled={ownerSaving}
                                  onClick={() => {
                                    setConfirmDeleteOwner({ id: o.id, name: o.owner_name });
                                    setConfirmDeleteOwnerOpen(true);
                                  }}
                                >
                                  Eliminar
                                </button>
                              </div>
                            </div>

                            {o.notes ? <div className="help" style={{ margin: 0 }}>{o.notes}</div> : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </section>
            </>
          )}

          {/* Documentos */}
          {tab === "documentos" && (
            <DocumentsTab clientId={clientId} />
          )}

          {/* Pagos */}
          {tab === "pagos" && (
            <section className="card" style={{ marginTop: 12 }}>
              <div className="cardBody" style={{ display: "grid", gap: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div className="title">Pagos</div>
                    <div className="subtitle">Registra cuotas y calcula el faltante automáticamente.</div>
                  </div>

                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                    <button className="btn" type="button" onClick={openTotalModal} disabled={!paymentsSupported}>
                      Monto total
                    </button>

                    <button className="btn btnPrimary btnMobileFull" type="button" onClick={openAddPayment} disabled={!paymentsSupported}>
                      Añadir pago
                    </button>
                  </div>
                </div>

                {!paymentsSupported ? (
                  <div className="errorText">
                    La tabla/columna de pagos no existe todavía. Ejecuta la migración de pagos en supabase/migrations.
                  </div>
                ) : null}

                {paymentsError ? <div className="errorText">{paymentsError}</div> : null}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 10,
                  }}
                >
                  <div className="card" style={{ margin: 0 }}>
                    <div className="cardBody" style={{ display: "grid", gap: 6 }}>
                      <div className="label">Monto total</div>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>
                        {totalAmount == null ? "—" : formatMoneyBOB(totalAmount)}
                      </div>
                      <div className="help" style={{ margin: 0 }}>Editable</div>
                    </div>
                  </div>

                  <div className="card" style={{ margin: 0 }}>
                    <div className="cardBody" style={{ display: "grid", gap: 6 }}>
                      <div className="label">Pagado</div>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>{formatMoneyBOB(totalPaid)}</div>
                      <div className="help" style={{ margin: 0 }}>{payments.length} pagos</div>
                    </div>
                  </div>

                  <div className="card" style={{ margin: 0 }}>
                    <div className="cardBody" style={{ display: "grid", gap: 6 }}>
                      <div className="label">Faltante</div>
                      <div
                        style={{
                          fontWeight: 900,
                          fontSize: 18,
                          color:
                            remaining == null
                              ? "inherit"
                              : remaining <= 0
                                ? "#0f7a31"
                                : "#8b4f06",
                        }}
                      >
                        {remaining == null ? "—" : formatMoneyBOB(remaining)}
                      </div>
                      <div className="help" style={{ margin: 0 }}>
                        {remaining == null
                          ? "Define un monto total para calcular"
                          : remaining <= 0
                            ? "Completado"
                            : "Pendiente"}
                      </div>
                    </div>
                  </div>
                </div>

                {paymentsSupported ? (
                  <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
                    {payments.length === 0 ? (
                      <div className="help">Aún no hay pagos registrados.</div>
                    ) : (
                      payments.map((p) => {
                        const amt = asNumber(p.amount) ?? 0;
                        const label = `${formatMoneyBOB(amt)} — ${p.paid_at}`;

                        return (
                          <div
                            key={p.id}
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 14,
                              padding: 12,
                              background: "#fff",
                              boxShadow: "0 10px 22px rgba(2, 12, 27, 0.06)",
                              display: "grid",
                              gap: 8,
                            }}
                          >
                            <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                              <div>
                                <div style={{ fontWeight: 900 }}>{formatMoneyBOB(amt)}</div>
                                <div className="help" style={{ margin: 0 }}>
                                  {new Date(p.paid_at).toLocaleDateString("es-BO")}
                                </div>
                              </div>

                              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                                <button className="btn" type="button" onClick={() => openEditPayment(p)}>
                                  Editar
                                </button>
                                <button
                                  className="btn btnDangerHover"
                                  type="button"
                                  disabled={paymentSaving}
                                  onClick={() => {
                                    setConfirmDeletePayment({ id: p.id, label });
                                    setConfirmDeletePaymentOpen(true);
                                  }}
                                >
                                  Eliminar
                                </button>
                              </div>
                            </div>

                            {p.notes ? <div className="help" style={{ margin: 0 }}>{p.notes}</div> : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </div>
            </section>
          )}
        </>
      )}

      <Modal title="Editar cliente" open={editOpen} onClose={() => setEditOpen(false)}>
        <div style={{ display: "grid", gap: 12 }}>
          <div className="field">
            <div className="label">Nombre completo</div>
            <input
              className="input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Ej: Juan Pérez"
            />
          </div>

          <div className="field">
            <div className="label">Celular</div>
            <input
              className="input"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder="8 dígitos"
              inputMode="numeric"
            />
          </div>

          <div className="field">
            <div className="label">CI</div>
            <input
              className="input"
              value={editCi}
              onChange={(e) => setEditCi(e.target.value)}
              placeholder="Ej: 1234567"
            />
          </div>

          <div className="field">
            <div className="label">Fecha de nacimiento</div>
            <input
              className="input"
              type="date"
              value={editBirthDate}
              onChange={(e) => setEditBirthDate(e.target.value)}
            />
            <div className="help">Opcional</div>
          </div>

          <div className="field">
            <div className="label">Email</div>
            <input
              className="input"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              placeholder="ejemplo@correo.com"
            />
          </div>

          <div className="field">
            <div className="label">Dirección</div>
            <input
              className="input"
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
              placeholder="Dirección"
            />
          </div>

          <div className="field">
            <div className="label">Notas</div>
            <textarea
              className="input"
              style={{ minHeight: 90, resize: "vertical" }}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Notas internas"
            />
          </div>

          {editError ? <div className="errorText">{editError}</div> : null}

          <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
            <button className="btn" type="button" onClick={() => setEditOpen(false)} disabled={editSaving}>
              Cancelar
            </button>
            <button className="btn btnPrimary" type="button" onClick={saveEdit} disabled={editSaving}>
              {editSaving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        title="Monto total"
        open={totalOpen}
        onClose={() => {
          if (totalSaving) return;
          setTotalOpen(false);
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div className="help" style={{ margin: 0 }}>
            Define el monto total del servicio para calcular faltante.
          </div>

          <div className="field">
            <div className="label">Monto total (Bs)</div>
            <input
              className="input"
              value={totalInput}
              onChange={(e) => setTotalInput(e.target.value)}
              placeholder="Ej: 200"
              inputMode="decimal"
            />
            <div className="help">Vacío = sin monto total</div>
          </div>

          {totalError ? <div className="errorText">{totalError}</div> : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button className="btn" type="button" disabled={totalSaving} onClick={() => setTotalOpen(false)}>
              Cancelar
            </button>
            <button className="btn btnPrimary" type="button" disabled={totalSaving} onClick={saveTotalAmount}>
              {totalSaving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        title={paymentEditId ? "Editar pago" : "Añadir pago"}
        open={paymentOpen}
        onClose={() => {
          if (paymentSaving) return;
          setPaymentOpen(false);
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div className="field">
            <div className="label">Monto (Bs)</div>
            <input
              className="input"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              placeholder="Ej: 20"
              inputMode="decimal"
            />
          </div>

          <div className="field">
            <div className="label">Fecha</div>
            <input className="input" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </div>

          <div className="field">
            <div className="label">Notas</div>
            <textarea
              className="input"
              style={{ minHeight: 90, resize: "vertical" }}
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              placeholder="Opcional"
            />
          </div>

          {paymentFormError ? <div className="errorText">{paymentFormError}</div> : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button className="btn" type="button" disabled={paymentSaving} onClick={() => setPaymentOpen(false)}>
              Cancelar
            </button>
            <button className="btn btnPrimary" type="button" disabled={paymentSaving} onClick={savePayment}>
              {paymentSaving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        title="Confirmar eliminación"
        open={confirmDeletePaymentOpen}
        onClose={() => {
          if (paymentSaving) return;
          setConfirmDeletePaymentOpen(false);
          setConfirmDeletePayment(null);
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div className="help" style={{ margin: 0 }}>
            Vas a eliminar este pago:
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 12,
              background: "rgba(239, 68, 68, 0.04)",
            }}
          >
            <div style={{ fontWeight: 900, lineHeight: 1.2 }}>{confirmDeletePayment?.label ?? ""}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              className="btn"
              type="button"
              disabled={paymentSaving}
              onClick={() => {
                setConfirmDeletePaymentOpen(false);
                setConfirmDeletePayment(null);
              }}
            >
              Cancelar
            </button>
            <button
              className="btn btnDangerHover"
              type="button"
              disabled={paymentSaving || !confirmDeletePayment}
              onClick={async () => {
                if (!confirmDeletePayment) return;
                await deletePayment(confirmDeletePayment.id);
              }}
            >
              {paymentSaving ? "Eliminando..." : "Eliminar"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        title={ownerEditId ? "Editar dueño" : "Añadir dueño"}
        open={ownerOpen}
        onClose={() => {
          if (ownerSaving) return;
          setOwnerOpen(false);
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div className="field">
            <div className="label">Nombre del dueño</div>
            <input className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field">
              <div className="label">Año inicio</div>
              <input
                className="input"
                value={ownerStartYear}
                onChange={(e) => setOwnerStartYear(e.target.value)}
                inputMode="numeric"
                placeholder="Ej: 2018"
              />
            </div>

            <div className="field">
              <div className="label">Año fin</div>
              <input
                className="input"
                value={ownerEndYear}
                onChange={(e) => setOwnerEndYear(e.target.value)}
                inputMode="numeric"
                placeholder="Ej: 2022"
                disabled={ownerIsCurrent}
              />
              {ownerIsCurrent ? <div className="help">Desactivado si es el actual</div> : null}
            </div>
          </div>

          <label className="row" style={{ gap: 10, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={ownerIsCurrent}
              onChange={(e) => setOwnerIsCurrent(e.target.checked)}
            />
            <span style={{ fontWeight: 800 }}>Es el dueño actual</span>
          </label>

          <div className="field">
            <div className="label">Notas</div>
            <textarea
              className="input"
              style={{ minHeight: 90, resize: "vertical" }}
              value={ownerNotes}
              onChange={(e) => setOwnerNotes(e.target.value)}
              placeholder="Opcional"
            />
          </div>

          {ownerFormError ? <div className="errorText">{ownerFormError}</div> : null}

          <div className="row" style={{ justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={() => setOwnerOpen(false)} disabled={ownerSaving}>
              Cancelar
            </button>
            <button className="btn btnPrimary" type="button" onClick={saveOwner} disabled={ownerSaving}>
              {ownerSaving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        title="Confirmar eliminación"
        open={confirmDeleteOwnerOpen}
        onClose={() => {
          if (ownerSaving) return;
          setConfirmDeleteOwnerOpen(false);
          setConfirmDeleteOwner(null);
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div className="help" style={{ margin: 0 }}>
            Vas a eliminar este registro de tradición:
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 12,
              background: "rgba(239, 68, 68, 0.04)",
            }}
          >
            <div style={{ fontWeight: 900, lineHeight: 1.2 }}>{confirmDeleteOwner?.name ?? ""}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              className="btn"
              type="button"
              disabled={ownerSaving}
              onClick={() => {
                setConfirmDeleteOwnerOpen(false);
                setConfirmDeleteOwner(null);
              }}
            >
              Cancelar
            </button>

            <button
              className="btn btnDangerHover"
              type="button"
              disabled={ownerSaving || !confirmDeleteOwner}
              onClick={async () => {
                if (!confirmDeleteOwner) return;
                await deleteOwner(confirmDeleteOwner.id);
              }}
            >
              {ownerSaving ? "Eliminando..." : "Eliminar"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        title="Eliminar cliente"
        open={confirmDeleteClientOpen}
        onClose={() => {
          if (deleteClientSaving) return;
          setConfirmDeleteClientOpen(false);
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div className="help" style={{ margin: 0 }}>
            Estás por eliminar este cliente y toda su información (documentos, archivos, pagos y tradición).
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 12,
              background: "rgba(239, 68, 68, 0.04)",
            }}
          >
            <div style={{ fontWeight: 900, lineHeight: 1.2 }}>{client?.full_name ?? ""}</div>
            <div className="help" style={{ marginTop: 6 }}>
              Celular: <b>{client?.phone ?? ""}</b>
            </div>
          </div>

          <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
            <button
              className="btn"
              type="button"
              onClick={() => setConfirmDeleteClientOpen(false)}
              disabled={deleteClientSaving}
            >
              Cancelar
            </button>
            <button
              className="btn btnDangerHover"
              type="button"
              disabled={deleteClientSaving}
              onClick={() => {
                setConfirmDeleteClientOpen(false);
                setConfirmDeleteClient2Open(true);
              }}
            >
              Continuar
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        title="Confirmar eliminación definitiva"
        open={confirmDeleteClient2Open}
        onClose={() => {
          if (deleteClientSaving) return;
          setConfirmDeleteClient2Open(false);
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div className="help" style={{ margin: 0 }}>
            Para confirmar, escribe <b>ELIMINAR</b>. Esto borrará también los archivos del Storage.
          </div>

          <div className="field">
            <div className="label">Confirmación</div>
            <input
              className="input"
              placeholder="Escribe ELIMINAR"
              value={confirmDeleteClientText}
              onChange={(e) => setConfirmDeleteClientText(e.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              className="btn"
              type="button"
              disabled={deleteClientSaving}
              onClick={() => setConfirmDeleteClient2Open(false)}
            >
              Cancelar
            </button>
            <button
              className="btn btnDangerHover"
              type="button"
              disabled={deleteClientSaving || confirmDeleteClientText.trim().toUpperCase() !== "ELIMINAR"}
              onClick={async () => {
                await deleteClient();
              }}
            >
              {deleteClientSaving ? "Eliminando..." : "Eliminar"}
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}

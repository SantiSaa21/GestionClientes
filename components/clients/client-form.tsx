"use client";

import { useState } from "react";

export function ClientForm(props: {
  onCreate: (input: { full_name: string; phone: string }) => Promise<void>;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  const [saving, setSaving] = useState(false);

  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  function validate() {
    let ok = true;

    setNameError(null);
    setPhoneError(null);

    const name = fullName.trim();
    const ph = phone.trim();

    if (!name) {
      setNameError("El nombre es requerido.");
      ok = false;
    }

    if (!/^\d{8}$/.test(ph)) {
      setPhoneError("Debe tener 8 dígitos (sin +591).");
      ok = false;
    }

    return ok;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    await props.onCreate({ full_name: fullName.trim(), phone: phone.trim() });
    setSaving(false);

    setFullName("");
    setPhone("");
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
      <div className="field">
        <div className="label">Nombre completo</div>
        <input
          className={`input ${nameError ? "inputError" : ""}`}
          placeholder="Ej: Juan Pérez"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        {nameError && <div className="errorText">{nameError}</div>}
      </div>

      <div className="field">
        <div className="label">Celular</div>
        <input
          className={`input ${phoneError ? "inputError" : ""}`}
          placeholder="8 dígitos"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="numeric"
        />
        {phoneError && <div className="errorText">{phoneError}</div>}
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button disabled={saving} type="submit" className="btn btnPrimary">
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </form>
  );
}

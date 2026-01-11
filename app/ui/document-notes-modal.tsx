"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../components/ui/modal";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  initialNotes: string | null;
  onSave: (notes: string) => Promise<void>;
};

export function DocumentNotesModal({
  open,
  onClose,
  title,
  initialNotes,
  onSave,
}: Props) {
  const [value, setValue] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedInitial = useMemo(() => initialNotes ?? "", [initialNotes]);

  useEffect(() => {
    if (!open) return;
    setValue(normalizedInitial);
    setError(null);
    setSaving(false);
  }, [open, normalizedInitial]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
      onClose();
    } catch {
      setError("No se pudieron guardar las notas. Intenta nuevamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={title} open={open} onClose={onClose}>
      <div style={{ display: "grid", gap: 10 }}>
        <div className="field">
          <label className="label">Notas</label>
          <textarea
            className="input"
            rows={7}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Escribe aquí lo que falta, observaciones, etc."
            style={{ resize: "vertical", padding: 12 }}
          />
          {error ? <div className="errorText">{error}</div> : null}
        </div>

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" type="button" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btnPrimary" type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar notas"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

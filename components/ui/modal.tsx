"use client";

import React, { useEffect, useId } from "react";

type ModalProps = {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export function Modal({ title, open, onClose, children }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(11, 18, 32, 0.35)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        className="card"
        style={{
          width: "min(720px, 100%)",
          overflow: "hidden",
        }}
      >
        <div className="cardBody" style={{ display: "grid", gap: 12 }}>
          <div className="row">
            <div>
              <div id={titleId} style={{ fontWeight: 900, fontSize: 18 }}>
                {title}
              </div>
            </div>

            <button className="btn btnGhost" type="button" onClick={onClose}>
              Cerrar
            </button>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}

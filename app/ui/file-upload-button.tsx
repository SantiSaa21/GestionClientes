"use client";

import { useRef } from "react";

type Props = {
  label?: string;
  accept?: string;
  disabled?: boolean;
  onPick: (file: File) => Promise<void>;
};

export function FileUploadButton({
  label = "Subir",
  accept = "application/pdf,image/*",
  disabled,
  onPick,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          await onPick(file);
        }}
      />
      <button
        className="btn"
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {label}
      </button>
    </>
  );
}

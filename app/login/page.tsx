"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);

  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const allowlist = (process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  function validate() {
    let ok = true;

    setEmailError(null);
    setPasswordError(null);
    setGlobalError(null);

    if (!email.trim()) {
      setEmailError("El correo es requerido.");
      ok = false;
    }

    if (!password.trim()) {
      setPasswordError("La contraseña es requerida.");
      ok = false;
    }

    return ok;
  }

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setGlobalError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setGlobalError("No se pudo iniciar sesión. Verifica tus datos.");
      return;
    }

    // Si se configuró una allowlist de admins, bloquea cualquier otro correo.
    if (allowlist.length > 0) {
      const { data } = await supabase.auth.getUser();
      const signedEmail = (data.user?.email ?? "").toLowerCase();
      if (!signedEmail || !allowlist.includes(signedEmail)) {
        await supabase.auth.signOut();
        setGlobalError("No autorizado. Ese correo no está habilitado para acceder.");
        return;
      }
    }

    router.push("/clients");
  }

  return (
    <main className="card">
      <div className="cardHeader">
        <h1 className="title">Ingreso</h1>
        <p className="subtitle">Acceso solo para administración</p>
      </div>

      <div className="cardBody">
        <form onSubmit={onLogin} style={{ display: "grid", gap: 12 }}>
          <div className="field">
            <div className="label">Correo</div>
            <input
              className={`input ${emailError ? "inputError" : ""}`}
              placeholder="correo@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            {emailError && <div className="errorText">{emailError}</div>}
          </div>

          <div className="field">
            <div className="label">Contraseña</div>
            <input
              className={`input ${passwordError ? "inputError" : ""}`}
              placeholder="••••••••"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {passwordError && <div className="errorText">{passwordError}</div>}
          </div>

          {globalError && <div className="errorText">{globalError}</div>}

          <button disabled={loading} type="submit" className="btn btnPrimary">
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </main>
  );
}

"use client";

export type ClientRow = {
  id: string;
  full_name: string;
  phone: string;
};

export function ClientList(props: {
  clients: ClientRow[];
  onView: (id: string) => void;
}) {
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="cardBody" style={{ padding: 0 }}>
        {/* Desktop / Tablet: tabla */}
        <div className="listDesktop">
          <table className="table">
            <thead className="tableHeadBlue">
              <tr>
                <th className="th">Nombre</th>
                <th className="th">Celular</th>
                <th className="th"></th>
              </tr>
            </thead>

            <tbody>
              {props.clients.map((c) => (
                <tr key={c.id} className="trHover">
                  <td className="td" style={{ fontWeight: 900 }}>
                    {c.full_name}
                  </td>
                  <td className="td">{c.phone}</td>
                  <td className="td" style={{ width: 160 }}>
                    <button
                      className="btn btnOutlinePrimary"
                      onClick={() => props.onView(c.id)}
                    >
                      Ver ficha
                    </button>
                  </td>
                </tr>
              ))}

              {props.clients.length === 0 && (
                <tr>
                  <td className="td" colSpan={3} style={{ color: "var(--muted)" }}>
                    No hay clientes todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Móvil: cards */}
        <div className="listMobile">
          <div style={{ padding: 12 }}>
            {props.clients.length === 0 && (
              <div style={{ color: "var(--muted)" }}>No hay clientes todavía.</div>
            )}

            <div style={{ display: "grid", gap: 10 }}>
              {props.clients.map((c) => (
                <div
                  key={c.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    padding: 12,
                    background: "#fff",
                    boxShadow: "0 10px 22px rgba(2, 12, 27, 0.06)",
                  }}
                >
                  <div style={{ fontWeight: 900, fontSize: 16 }}>{c.full_name}</div>
                  <div style={{ color: "var(--muted)", marginTop: 4 }}>{c.phone}</div>

                  <div style={{ marginTop: 10 }}>
                    <button
                      className="btn btnOutlinePrimary"
                      onClick={() => props.onView(c.id)}
                    >
                      Ver ficha
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

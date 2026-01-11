import "./globals.css";

export const metadata = {
  title: "Gestión de Clientes",
  description: "Sistema interno",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="container">{children}</div>

        <div className="floatingBrand" aria-label="Marca">
          <div className="floatingLogo">SS</div>
        </div>
      </body>
    </html>
  );
}

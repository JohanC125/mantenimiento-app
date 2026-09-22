import "./globals.css";

export const metadata = {
  title: "Gestión de Mantenimiento",
  description: "Aplicación Web de Gestión de Órdenes de Mantenimiento",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

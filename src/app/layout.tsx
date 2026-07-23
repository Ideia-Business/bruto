import type { Metadata } from "next";
import { Inter, Source_Serif_4, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

// Inter opera a UI (nav, botões, metadados); Source Serif 4 é a fonte de
// leitura (aula, resumo, transcrição); Fraunces dá gravitas aos títulos.
// latin-ext garante a acentuação PT-BR (ã õ ç á é í ó ú).
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});
const sourceSerif = Source_Serif_4({
  variable: "--font-reading",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});
const fraunces = Fraunces({
  variable: "--font-heading",
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  display: "swap",
});
const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Resume Video — resumos, transcrições e mapas mentais",
  description:
    "Cole um link do YouTube e receba resumo, transcrição e mapa mental — organizados como um catálogo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Tema claro "Papel Calmo" por padrão (serviço de leitura/estudo).
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${sourceSerif.variable} ${fraunces.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background font-sans text-foreground">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}

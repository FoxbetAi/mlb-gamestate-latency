import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cubs Feed Race",
  description: "Live dev Redpanda comparison for MLB gamestate feeds.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

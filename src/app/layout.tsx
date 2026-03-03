import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RunKit",
  description: "Web-based agent orchestration dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BrandSpace Forge",
  description: "Brand Space internal AI content operating system",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

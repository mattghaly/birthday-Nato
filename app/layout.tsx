import "./globals.css";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

const badScript = localFont({
  src: "./fonts/BadScript-Regular.ttf",
  display: "swap",
  weight: "400",
  style: "normal",
});

export const metadata: Metadata = { title: "Birthday photos" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={badScript.className}>{children}</body>
    </html>
  );
}

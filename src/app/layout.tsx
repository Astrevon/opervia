import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Opervia Approval Portal", template: "%s · Opervia Approval Portal" },
  description: "Client content approval and publishing readiness, in one place. Made by Opervia.",
  applicationName: "Opervia Approval Portal",
  icons: { icon: "/opervia-mark.svg" },
};

export const viewport: Viewport = {
  themeColor: "#060a14",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full`}>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

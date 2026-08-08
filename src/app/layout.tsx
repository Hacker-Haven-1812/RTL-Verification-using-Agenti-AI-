import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agentic RISC-V RTL Verification — VLSID 2026",
  description:
    "Real-time AI-driven multi-agent framework for autonomous RTL functional verification of RISC-V processors. Case Generation, Coverage Analysis, Missing Case Suggestion, and Formal Property Generation agents running a live closed-loop verification flow.",
  keywords: [
    "RISC-V",
    "RTL Verification",
    "Agentic AI",
    "Formal Verification",
    "Coverage Closure",
    "VLSID 2026",
    "VLSI Design",
    "SymbiYosys",
    "Verilator",
  ],
  authors: [{ name: "VLSID 2026 User Design Track" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, Geist_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

// Editorial serif for headings + display.
const fraunces = Fraunces({
  variable: "--font-heading",
  subsets: ["latin"],
});

// Readable humanist grotesk for body / UI.
const hanken = Hanken_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Mono for clock times and numerals.
const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Almanac · Task App",
  description: "Personal planning hub: see, plan, and learn from how your effort is distributed over time.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fraunces.variable} ${hanken.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-svh overflow-hidden flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}

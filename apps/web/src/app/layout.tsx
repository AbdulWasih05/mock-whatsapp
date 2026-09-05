import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chat",
  description: "Real-time 1:1 messaging",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-dvh antialiased`}
    >
      {/* h-dvh, not h-screen/vh — CLAUDE.md §8: 100vh mis-sizes under a mobile
          software keyboard, dvh tracks the actual visible viewport. */}
      <body className="h-full flex flex-col overflow-hidden">{children}</body>
    </html>
  );
}

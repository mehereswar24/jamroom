import type { Metadata } from "next";
import { Orbitron, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "JamRoom — Synchronized Cyber Audio Rooms",
  description: "Synchronized music rooms with friends: import Spotify playlists, YouTube tracks, chat, and vibe in zero-latency sync.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${orbitron.variable} ${jakarta.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#050505] text-[#ffffff] font-sans selection:bg-white selection:text-black relative overflow-x-hidden">
        {/* Monochrome Ambient Glows */}
        <div className="fixed -top-32 -left-32 w-96 h-96 bg-white/5 rounded-full blur-[120px] pointer-events-none z-0" />
        <div className="fixed top-1/2 -right-32 w-96 h-96 bg-white/4 rounded-full blur-[140px] pointer-events-none z-0" />
        <div className="fixed -bottom-32 left-1/3 w-[500px] h-[500px] bg-white/3 rounded-full blur-[150px] pointer-events-none z-0" />
        {children}
      </body>
    </html>
  );
}

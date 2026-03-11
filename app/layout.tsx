import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";

import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";

import "@fontsource/jetbrains-mono/500.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Nondies Fantasy League",
  description: "Fantasy cricket for Oxford & Bletchingdon Nondescripts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} antialiased bg-black text-white`}>
        {children}
      </body>
    </html>
  );
}

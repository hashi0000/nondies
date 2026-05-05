import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { CreditFooter } from "@/components/CreditFooter";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
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
      <body className={`${plusJakarta.className} antialiased bg-black text-white`}>
        <div className="flex min-h-dvh flex-col">
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          <CreditFooter />
        </div>
      </body>
    </html>
  );
}

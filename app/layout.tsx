import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VISTA-3D Console",
  description: "Interactive client for the NVIDIA NIM VISTA-3D segmentation model.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-[#0a0c0e] text-[#e7eaec] antialiased">
        {children}
      </body>
    </html>
  );
}

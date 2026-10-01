import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "נועה טורג'מן", description: "ניהול הקליניקה" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700;800&family=Frank+Ruhl+Libre:wght@500;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}

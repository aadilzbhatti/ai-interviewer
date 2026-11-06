import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mock Interviewer",
  description: "AI-run mock coding interviews with a live IDE and calibrated help.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

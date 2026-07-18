import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Triviality CRM", description: "AI-powered North American trivia sales intelligence" };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }

import type { ReactNode } from "react";
import {LanguageProvider} from "@/components/language";
import "./globals.css";
import "@/components/sample.css";

export const metadata = {title: "Verifiable Blackbox", description: "Robot job records, approval and verifiable demo payments."};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><LanguageProvider>{children}</LanguageProvider></body></html>;
}

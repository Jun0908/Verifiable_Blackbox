import {publicPreview} from "@/lib/public-preview";
import type { ReactNode } from "react";
import {LanguageProvider} from "@/components/language";
import {Providers} from "./providers";
import "./globals.css";
import "@/components/sample.css";

export const metadata = {title: "Verifiable Blackbox", description: "Robot job records, approval and verifiable demo payments."};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><LanguageProvider>{publicPreview || process.env.NEXT_PUBLIC_PRIVY_APP_ID || process.env.NEXT_PUBLIC_LOCAL_DEMO === "true" ? <Providers>{children}</Providers> : children}</LanguageProvider></body></html>;
}

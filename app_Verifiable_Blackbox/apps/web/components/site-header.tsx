"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useLanguage} from "./language";

export function SiteHeader({onOverview}: {onOverview?: () => void} = {}) {
  const {language, setLanguage, t} = useLanguage();
  const path = usePathname();
  return <header className="topbar">
    <Link href="/" onClick={onOverview ? e => {e.preventDefault(); onOverview();} : undefined} className="brand-lockup"><span className="brand-mark">VB</span><div><strong>Verifiable Blackbox</strong><span>Proof-triggered robot commerce</span></div></Link>
    <div className="header-tools"><nav aria-label={t("Main navigation", "メインナビゲーション")}><Link href="/" onClick={onOverview ? e => {e.preventDefault(); onOverview();} : undefined} aria-current={path === "/" ? "page" : undefined}>{t("Overview", "概要")}</Link><Link href="/rover" aria-current={path === "/rover" ? "page" : undefined}>{t("Operate", "操作")}</Link><Link href="/ledger" aria-current={path === "/ledger" ? "page" : undefined}>{t("Ledger", "台帳")}</Link></nav>
      <div className="language-switch" aria-label={t("Language", "言語")}><button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button><button type="button" aria-pressed={language === "ja"} onClick={() => setLanguage("ja")}>日本語</button></div><span className="mock-badge">DEMO</span>
    </div>
  </header>;
}

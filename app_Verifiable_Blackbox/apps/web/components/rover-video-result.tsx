"use client";
import {useState} from "react";
import dynamic from "next/dynamic";
import type {RoverSessionRecord} from "@/lib/rover-session";
import {useLanguage} from "./language";

const Recording = dynamic(() => import("./rover-recording-panel").then(module => module.RoverRecordingPanel));
const Disclosure = dynamic(() => import("./world-disclosure").then(module => module.WorldDisclosure));

export function RoverVideoResult({record}: {record: RoverSessionRecord}) {
  const {t} = useLanguage();
  const [open, setOpen] = useState(false);
  if (record.payment?.phase !== "PAID") return null;
  return <section className="panel" aria-label={t("Job video", "今回の動画")}>
    <h2>{t("Job completed", "Jobが完了しました")}</h2>
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? t("Close video", "動画を閉じる") : t("View job video", "今回の動画を見る")}
    </button>
    {open && <><Recording record={record} /><Disclosure jobId={record.context.jobId} sessionId={record.context.sessionId} /></>}
  </section>;
}

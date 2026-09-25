"use client";
import {useLanguage} from "./language";

export function JobProgress({created, operated, verified, paid, operating = false, sample = false}: {created: boolean; operated: boolean; verified: boolean; paid: boolean; operating?: boolean; sample?: boolean}) {
  const {t} = useLanguage();
  const steps = [
    {label:t("Create job", "仕事を作成"), done:created},
    {label:sample ? t("Prepare sample", "サンプルを準備") : t("Operate robot", "ロボット操作"), done:operated},
    {label:t("Verify record", "記録を検証"), done:verified},
    {label:t("Payment", "支払い結果"), done:paid},
  ];
  const current = paid ? -1 : operating ? 1 : steps.findIndex(step => !step.done);
  return <ol className="job-progress" aria-label={t("Job progress", "仕事の進捗")}>{steps.map((step,index) => <li key={index} className={`${step.done ? "done" : ""} ${current === index ? "current" : ""}`} aria-current={current === index ? "step" : undefined}><span>{step.done ? "✓" : index+1}</span><strong>{step.label}</strong></li>)}</ol>;
}

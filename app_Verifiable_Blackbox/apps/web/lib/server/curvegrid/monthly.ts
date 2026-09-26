import "server-only";
import rows from "../../ledger/monthly-sample.json" with {type:"json"};
import {validateUsage} from "@/lib/ledger/monthly-demo";
export const sampleRows = validateUsage(rows);
export function period(request: Request) {
  const value = new URL(request.url).searchParams.get("period") ?? "2026-09";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw Error("INVALID_PERIOD");
  return value;
}

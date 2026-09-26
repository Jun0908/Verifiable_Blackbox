export type Analysis = {
  case: string; scene: string; execution: "saved" | "live";
  model: string; model_revision: string; device: string;
  stego_sha256: string; recovered_frames_sha256: string;
  request_id?: string; analyzed_at?: string; total_seconds?: number;
  results: {recovered: {label: string; changed_area_percent: number; inference_seconds: number}};
};
export type Scene = {
  id: string; titleEn: string; titleJa: string; creator: string; source: string; base: string;
  manifest: {case: string; scene: string; frames: number; fps: number; width: number; height: number;
    stego_sha256: string; recovered_frames_sha256: string; recognition_profile: string;
    files_sha256: Record<string,string>};
  savedAnalysis: Analysis;
};
export type Case = {id: string; titleEn: string; titleJa: string; scenes: Scene[]};
export type Catalog = {version: number; defaultCase: string; defaultScene: string; cases: Case[]};

export function matchesAnalysis(value: unknown, scene: Scene): value is Analysis {
  if (!value || typeof value !== "object") return false;
  const row = value as Analysis;
  const result = row.results?.recovered;
  return row.case === scene.manifest.case && row.scene === scene.id &&
    row.stego_sha256 === scene.manifest.stego_sha256 &&
    row.recovered_frames_sha256 === scene.manifest.recovered_frames_sha256 &&
    row.model === "ROI frame difference" && row.model_revision === "rover-motion-v1" && row.device === "cpu" &&
    !!result && ["ROVER_MOVING","ROVER_STILL","ROVER_UNCERTAIN"].includes(result.label) &&
    Number.isFinite(result.changed_area_percent) && result.changed_area_percent >= 0 && result.changed_area_percent <= 100 &&
    Number.isFinite(result.inference_seconds) && result.inference_seconds >= 0;
}

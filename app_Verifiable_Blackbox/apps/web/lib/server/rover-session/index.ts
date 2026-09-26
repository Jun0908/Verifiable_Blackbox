import "server-only";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {getDeployment} from "../config";
import {getFundedDemoJob} from "../provider";
import {RoverSessions} from "./service";
import {sessionStore} from "./guard";
import {bridgeUrl} from "../bridge-config";

export async function videoPolicy() {
  if (!process.env.VBB_BRIDGE_TOKEN) throw Error("CAMERA_CONFIGURATION_REQUIRED");
  const response = await fetch(bridgeUrl("camera"), {headers: {Authorization: `Bearer ${process.env.VBB_BRIDGE_TOKEN}`},
    signal: AbortSignal.timeout(3000), cache: "no-store"});
  if (!response.ok) throw Error("CAMERA_CONFIGURATION_REQUIRED");
  const camera = await response.json();
  if (!camera.configured || typeof camera.url !== "string") throw Error("CAMERA_CONFIGURATION_REQUIRED");
  return {cameraUrl: camera.url, motion: JSON.parse(await readFile(resolve(process.cwd(), "../../services/stegavar/config/rover_motion.json"), "utf8"))};
}
export function roverSessions() {
  const deployment = getDeployment();
  return new RoverSessions({store: sessionStore(), evaluator: deployment.evaluator, token: deployment.mockUsdc,
    fundedJob: jobId => getFundedDemoJob(BigInt(jobId)), now: () => Math.floor(Date.now() / 1000),
    videoPolicy});
}

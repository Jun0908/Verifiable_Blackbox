import "server-only";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {getDeployment} from "../config";
import {getFundedDemoJob} from "../provider";
import {RoverSessions} from "./service";
import {sessionStore} from "./guard";
export function roverSessions() {
  const deployment = getDeployment();
  return new RoverSessions({store: sessionStore(), evaluator: deployment.evaluator, token: deployment.mockUsdc,
    fundedJob: jobId => getFundedDemoJob(BigInt(jobId)), now: () => Math.floor(Date.now() / 1000),
    videoPolicy: async () => JSON.parse(await readFile(resolve(process.cwd(), "../../services/stegavar/config/rover_motion.json"), "utf8"))});
}

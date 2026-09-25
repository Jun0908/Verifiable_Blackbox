import { loadConfig } from "./config.js";
export function checkPhalaEnvironment(env: NodeJS.ProcessEnv) {
  const errors: string[] = [];
  if (!/^[a-z0-9][a-z0-9.:-]*\/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$/.test(env.DOCKER_IMAGE ?? "")) errors.push("DOCKER_IMAGE");
  if (env.VERIFIER_MODE !== "PHALA_DSTACK") errors.push("VERIFIER_MODE");
  if (env.VERDICT_SIGNING_KEY !== undefined) errors.push("VERDICT_SIGNING_KEY");
  if (env.DSTACK_SIMULATOR_ENDPOINT !== undefined) errors.push("DSTACK_SIMULATOR_ENDPOINT");
  if (env.CHAIN_ID !== "11155111") errors.push("CHAIN_ID");
  try {const u=new URL(env.RPC_URL ?? ""); if(u.protocol !== "https:") errors.push("RPC_URL");} catch {errors.push("RPC_URL");}
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/.test(env.PHALA_CVM_ID ?? "")) errors.push("PHALA_CVM_ID");
  if (env.DSTACK_KEY_PATH !== "verifiable-blackbox/verdict/secp256k1/v1") errors.push("DSTACK_KEY_PATH");
  if(errors.length) throw Error(`Invalid configuration: ${[...new Set(errors)].join(", ")}`);
  const config = loadConfig(env);
  return {config,image:env.DOCKER_IMAGE!,cvmId:env.PHALA_CVM_ID!,cliVersion:"1.1.22",instanceType:"tdx.small",diskSize:"20G"};
}

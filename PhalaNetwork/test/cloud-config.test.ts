import { describe, expect, it } from "vitest";
import { checkPhalaEnvironment } from "../src/cloud-config.js";
const env = {VERIFIER_MODE:"PHALA_DSTACK",CHAIN_ID:"11155111",RPC_URL:"https://rpc.example/credential",
  ERC8183_ADDRESS:"0x0000000000000000000000000000000000000001",EVIDENCE_HOOK_ADDRESS:"0x0000000000000000000000000000000000000002",EVALUATOR_ADDRESS:"0x0000000000000000000000000000000000000003",
  DOCKER_IMAGE:`ghcr.io/example/verifier@sha256:${"ab".repeat(32)}`,PHALA_CVM_ID:"cvm-test",DSTACK_KEY_PATH:"verifiable-blackbox/verdict/secp256k1/v1"};
describe("Phala preflight", () => {
  it("accepts explicit Sepolia deployment settings", () => expect(checkPhalaEnvironment(env)).toMatchObject({instanceType:"tdx.small",diskSize:"20G",cliVersion:"1.1.22"}));
  it.each([
    {DOCKER_IMAGE:"ghcr.io/example/verifier:latest"},{RPC_URL:"http://rpc.example/credential"},{CHAIN_ID:"1"},
    {VERDICT_SIGNING_KEY:"secret-key"},{VERDICT_SIGNING_KEY:""},{DSTACK_SIMULATOR_ENDPOINT:"http://localhost:8091"},
    {DSTACK_SIMULATOR_ENDPOINT:""},{VERIFIER_MODE:"LOCAL_DEV"},{PHALA_CVM_ID:""},{DSTACK_KEY_PATH:"different"},
    {EVALUATOR_ADDRESS:"invalid"},
  ])("rejects invalid cloud configuration %j", patch => {
    expect(()=>checkPhalaEnvironment({...env,...patch})).toThrow(/^Invalid configuration:/);
    try {checkPhalaEnvironment({...env,...patch});} catch(e) {expect((e as Error).message).not.toMatch(/secret-key|credential|localhost/);}
  });
});

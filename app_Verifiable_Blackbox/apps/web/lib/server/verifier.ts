import "server-only";
import {assertEvidencePayment, type RoverPaymentPermit} from "./rover-session/payment-permit";

import {randomBytes, createHash} from "node:crypto";
import {isAddress, isHex, recoverTypedDataAddress, type Hex} from "viem";
import {
  erc8183Abi,
  demoEvidenceToWire,
  evidenceCommitment,
  evidenceHookAbi,
  expectedChallenge,
  verdictTypes,
  type DemoEvidenceV1,
  type DemoVerifierInfo,
  type DemoVerifyResponse,
  type DemoVerdictWire,
} from "@/lib/contracts";
import {
  getDeployment,
  getPublicClient,
  getServerAccount,
  getVerifierConfig,
  type VerifierConfig,
} from "@/lib/server/config";

type RemoteErrorPayload = {
  error?: string | {reason?: string};
};

export class VerifierAdapterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VerifierAdapterError";
  }
}

function getRemoteReason(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as RemoteErrorPayload).error;
  const reason = typeof error === "string" ? error : error?.reason;
  return typeof reason === "string" && /^[A-Z][A-Z0-9_]+$/.test(reason) ? reason : fallback;
}

async function readRemoteJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new VerifierAdapterError("PHALA_INVALID_RESPONSE", 502);
  }
}

function parseRemoteSuccess(payload: unknown): DemoVerifyResponse {
  if (!payload || typeof payload !== "object") {
    throw new VerifierAdapterError("PHALA_INVALID_RESPONSE", 502);
  }
  const candidate = payload as Partial<DemoVerifyResponse>;
  const verdict = candidate.verdict as Partial<DemoVerdictWire> | undefined;
  const verifier = candidate.verifier as Partial<DemoVerifierInfo> | undefined;
  if (
    candidate.ok !== true
    || !candidate.signature
    || !isHex(candidate.signature)
    || candidate.signature.length !== 132
    || !verdict
    || typeof verdict.jobId !== "string"
    || !verdict.provider
    || !isAddress(verdict.provider)
    || !verdict.evidenceCommitment
    || !isHex(verdict.evidenceCommitment, {strict: true})
    || verdict.evidenceCommitment.length !== 66
    || verdict.outcome !== 1
    || typeof verdict.issuedAt !== "string"
    || typeof verdict.validUntil !== "string"
    || !verdict.nonce
    || !isHex(verdict.nonce, {strict: true})
    || verdict.nonce.length !== 66
    || !verifier
    || (verifier.mode !== "LOCAL_DEV" && verifier.mode !== "PHALA_DSTACK")
    || typeof verifier.attested !== "boolean"
    || typeof verifier.simulated !== "boolean"
    || !verifier.signerAddress
    || !isAddress(verifier.signerAddress)
    || (verifier.attested && verifier.simulated)
    || (verifier.mode === "LOCAL_DEV" && verifier.attested)
    || !/^[1-9][0-9]{0,77}$/.test(verdict.jobId)
    || !/^(0|[1-9][0-9]{0,19})$/.test(verdict.issuedAt ?? "")
    || !/^(0|[1-9][0-9]{0,19})$/.test(verdict.validUntil ?? "")
  ) {
    throw new VerifierAdapterError("PHALA_INVALID_RESPONSE", 502);
  }

  return {
    ok: true,
    verdict: verdict as DemoVerdictWire,
    signature: candidate.signature as Hex,
    verifier: {
      mode: verifier.mode,
      attested: verifier.attested,
      simulated: verifier.simulated,
      signerAddress: verifier.signerAddress,
      attestationPath: verifier.attestationPath ? "/api/demo/attestation" : null,
    },
  };
}

async function remoteFetch(
  config: Extract<VerifierConfig, {mode: "PHALA"}>,
  path: string,
  init?: RequestInit,
) {
  try {
    return await fetch(`${config.baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init?.body ? {"Content-Type": "application/json"} : {}),
        ...(config.bearerToken ? {Authorization: `Bearer ${config.bearerToken}`} : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new VerifierAdapterError("PHALA_TIMEOUT", 504);
    }
    throw new VerifierAdapterError("PHALA_UNAVAILABLE", 502);
  }
}

async function verifyWithPhala(
  evidence: DemoEvidenceV1,
  config: Extract<VerifierConfig, {mode: "PHALA"}>,
): Promise<DemoVerifyResponse> {
  const response = await remoteFetch(config, "/verify", {
    method: "POST",
    body: JSON.stringify({evidence: demoEvidenceToWire(evidence)}),
  });
  const payload = await readRemoteJson(response);
  if (!response.ok) {
    throw new VerifierAdapterError(
      getRemoteReason(payload, "PHALA_VERIFICATION_FAILED"),
      response.status >= 400 && response.status < 500 ? response.status : 502,
    );
  }
  const result = parseRemoteSuccess(payload);
  const deployment = getDeployment();
  if (result.verdict.jobId !== evidence.jobId.toString()) {
    throw new VerifierAdapterError("PHALA_VERDICT_JOB_MISMATCH", 502);
  }
  if (result.verdict.evidenceCommitment.toLowerCase() !== evidenceCommitment(evidence).toLowerCase()) {
    throw new VerifierAdapterError("PHALA_VERDICT_EVIDENCE_MISMATCH", 502);
  }
  if (result.verdict.provider.toLowerCase() !== deployment.provider.toLowerCase()) {
    throw new VerifierAdapterError("PHALA_VERDICT_PROVIDER_MISMATCH", 502);
  }
  if (result.verifier.signerAddress.toLowerCase() !== deployment.mockTeeSigner.toLowerCase()) {
    throw new VerifierAdapterError("PHALA_SIGNER_MISMATCH", 409);
  }
  const client = getPublicClient();
  const [block, job, commitment] = await Promise.all([
    client.getBlock(),
    client.readContract({address:deployment.erc8183,abi:erc8183Abi,functionName:"getJob",args:[evidence.jobId]}),
    client.readContract({address:deployment.evidenceHook,abi:evidenceHookAbi,functionName:"evidenceCommitments",args:[evidence.jobId]}),
  ]);
  const issuedAt=BigInt(result.verdict.issuedAt), validUntil=BigInt(result.verdict.validUntil);
  if(issuedAt > (1n<<64n)-1n || validUntil > (1n<<64n)-1n || issuedAt > block.timestamp+60n || validUntil <= block.timestamp || validUntil < issuedAt || validUntil-issuedAt > 900n || validUntil > job.expiredAt) {
    throw new VerifierAdapterError("PHALA_VERDICT_TIME_INVALID",502);
  }
  if(job.status!==2 || job.evaluator.toLowerCase()!==deployment.evaluator.toLowerCase()
    || job.hook.toLowerCase()!==deployment.evidenceHook.toLowerCase()
    || job.provider.toLowerCase()!==deployment.provider.toLowerCase()
    || commitment.toLowerCase()!==result.verdict.evidenceCommitment.toLowerCase()) {
    throw new VerifierAdapterError("PHALA_CHAIN_CONTEXT_MISMATCH",409);
  }
  const recoveredSigner = await recoverTypedDataAddress({
    domain: {
      name: "VerifiableBlackboxDemo",
      version: "1",
      chainId: deployment.chainId,
      verifyingContract: deployment.evaluator,
    },
    types: verdictTypes,
    primaryType: "DemoVerdictV1",
    message: {
      jobId: BigInt(result.verdict.jobId),
      provider: result.verdict.provider,
      evidenceCommitment: result.verdict.evidenceCommitment,
      outcome: result.verdict.outcome,
      issuedAt: BigInt(result.verdict.issuedAt),
      validUntil: BigInt(result.verdict.validUntil),
      nonce: result.verdict.nonce,
    },
    signature: result.signature,
  });
  if (recoveredSigner.toLowerCase() !== deployment.mockTeeSigner.toLowerCase()) {
    throw new VerifierAdapterError("PHALA_SIGNATURE_INVALID", 502);
  }
  return result;
}

async function verifyWithMock(evidence: DemoEvidenceV1): Promise<DemoVerifyResponse> {
  const jobId = evidence.jobId;
  if (evidence.robotId !== "rover-demo-001") throw new Error("ROBOT_ID_MISMATCH");
  if (evidence.challenge !== expectedChallenge(jobId, evidence.scenario)) {
    throw new Error("CHALLENGE_MISMATCH");
  }
  if (evidence.sequence !== 1n) throw new Error("SEQUENCE_MISMATCH");
  if (evidence.checkpoint !== "checkpoint-a") throw new Error("CHECKPOINT_MISMATCH");

  const deployment = getDeployment();
  const publicClient = getPublicClient();
  const [job, committedEvidence, block] = await Promise.all([
    publicClient.readContract({
      address: deployment.erc8183,
      abi: erc8183Abi,
      functionName: "getJob",
      args: [jobId],
    }),
    publicClient.readContract({
      address: deployment.evidenceHook,
      abi: evidenceHookAbi,
      functionName: "evidenceCommitments",
      args: [jobId],
    }),
    publicClient.getBlock(),
  ]);

  if (job.status !== 2) throw new Error("JOB_NOT_SUBMITTED");
  if (evidence.capturedAt > block.timestamp + 60n || evidence.capturedAt >= job.expiredAt) {
    throw new Error("EVIDENCE_TIME_INVALID");
  }

  const computedCommitment = evidenceCommitment(evidence);
  if (computedCommitment !== committedEvidence) {
    throw new VerifierAdapterError("EVIDENCE_HASH_MISMATCH", 422);
  }

  const issuedAt = block.timestamp;
  const validUntil = issuedAt + 300n < job.expiredAt ? issuedAt + 300n : job.expiredAt - 1n;
  const nonce = `0x${randomBytes(32).toString("hex")}` as Hex;
  const verdict: DemoVerdictWire = {
    jobId: jobId.toString(),
    provider: job.provider,
    evidenceCommitment: computedCommitment,
    outcome: 1,
    issuedAt: issuedAt.toString(),
    validUntil: validUntil.toString(),
    nonce,
  };
  const signature = await getServerAccount("tee").signTypedData({
    domain: {
      name: "VerifiableBlackboxDemo",
      version: "1",
      chainId: deployment.chainId,
      verifyingContract: deployment.evaluator,
    },
    types: verdictTypes,
    primaryType: "DemoVerdictV1",
    message: {
      jobId,
      provider: verdict.provider,
      evidenceCommitment: verdict.evidenceCommitment,
      outcome: verdict.outcome,
      issuedAt,
      validUntil,
      nonce,
    },
  });

  return {
    ok: true,
    verdict,
    signature,
    verifier: {
      mode: "MOCK_TEE",
      attested: false,
      simulated: true,
      signerAddress: deployment.mockTeeSigner,
      attestationPath: null,
    },
  };
}

export async function verifyEvidence(evidence: DemoEvidenceV1, permit?: RoverPaymentPermit) {
  await assertEvidencePayment(evidence.jobId, evidenceCommitment(evidence), permit);
  const config = getVerifierConfig();
  return config.mode === "PHALA"
    ? verifyWithPhala(evidence, config)
    : verifyWithMock(evidence);
}

export async function fetchAttestation() {
  const config = getVerifierConfig();
  if (config.mode !== "PHALA") {
    throw new VerifierAdapterError("ATTESTATION_UNAVAILABLE_IN_MOCK_MODE", 404);
  }
  const nonce = randomBytes(32).toString("hex");
  const response = await remoteFetch(config, `/attestation?nonce=${nonce}`);
  const payload = await readRemoteJson(response);
  if (!response.ok) {
    throw new VerifierAdapterError(
      getRemoteReason(payload, "PHALA_ATTESTATION_FAILED"),
      response.status >= 400 && response.status < 500 ? response.status : 502,
    );
  }
  if(!payload || typeof payload!=="object")throw new VerifierAdapterError("PHALA_ATTESTATION_INVALID",502);
  const report=payload as Record<string,unknown>;
  const deployment=getDeployment();
  if(typeof report.signerAddress!=="string" || report.signerAddress.toLowerCase()!==deployment.mockTeeSigner.toLowerCase()
    || !["LOCAL_DEV","PHALA_DSTACK"].includes(String(report.mode)) || typeof report.attested!=="boolean" || typeof report.simulated!=="boolean"
    || (report.mode==="LOCAL_DEV" && report.attested))throw new VerifierAdapterError("PHALA_ATTESTATION_INVALID",502);
  let nonceBound=false;
  if(report.mode==="PHALA_DSTACK") {
    const claims=report.claims as Record<string,unknown>|undefined;
    if(!claims || claims.nonce!==nonce || claims.chainId!==deployment.chainId
      || String(claims.evaluatorAddress).toLowerCase()!==deployment.evaluator.toLowerCase()
      || String(claims.signerAddress).toLowerCase()!==deployment.mockTeeSigner.toLowerCase()
      || report.reportData!==`0x${createHash('sha256').update(JSON.stringify(claims)).digest('hex')}`)throw new VerifierAdapterError("PHALA_ATTESTATION_BINDING_MISMATCH",502);
    nonceBound=true;
  }
  return {...report,requestNonce:nonce,nonceBound,quoteVerified:false,verificationNote:"Quote collection and claims matching only; cryptographic TDX quote verification is a separate step."};
}

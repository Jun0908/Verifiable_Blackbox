import { createPublicClient, http, type PublicClient } from "viem";
import { erc8183Abi, evidenceHookAbi } from "./contracts.js";
import { AppError, serviceError } from "./errors.js";
import type { Config } from "./config.js";
import type { JobSnapshot } from "./types.js";

export interface ChainReader { getJobSnapshot(jobId: bigint): Promise<JobSnapshot>; }
export type ReadClient = Pick<PublicClient, "getChainId" | "getBlock" | "readContract">;
export class ViemChainReader implements ChainReader {
  private readonly client: ReadClient;
  constructor(private readonly config: Config, client?: ReadClient) {
    this.client = client ?? createPublicClient({ transport: http(config.rpcUrl, { retryCount: 1, timeout: 10_000 }) });
  }
  async getJobSnapshot(jobId: bigint): Promise<JobSnapshot> {
    try {
      if (await this.client.getChainId() !== this.config.chainId) throw serviceError("CHAIN_ID_MISMATCH");
      const block = await this.client.getBlock({ blockTag: "latest" });
      if (block.number === null) throw serviceError("CHAIN_BLOCK_UNAVAILABLE");
      const [job, evidenceCommitment] = await Promise.all([
        this.client.readContract({ address: this.config.erc8183Address, abi: erc8183Abi, functionName: "getJob", args: [jobId], blockNumber: block.number }),
        this.client.readContract({ address: this.config.evidenceHookAddress, abi: evidenceHookAbi, functionName: "evidenceCommitments", args: [jobId], blockNumber: block.number }),
      ]);
      return { id: job.id, provider: job.provider, evaluator: job.evaluator, hook: job.hook,
        expiredAt: job.expiredAt, status: job.status, evidenceCommitment, blockTimestamp: block.timestamp };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw serviceError("CHAIN_READ_FAILED");
    }
  }
}

import type {Address, Hex} from "viem";

export type GasStatus = {
  chainId: number;
  address: Address;
  balanceWei: string;
  requiredWei: string;
  targetWei: string;
  ready: boolean;
  available: boolean;
  reason?: "disabled" | "pool-empty" | "daily-limit" | "budget-limit" | "pending" | "high-fees";
  poolAddress?: Address;
  poolBalanceWei?: string;
  transactionHash?: Hex;
  day: string;
  message: string;
};

export function gasFundingMessage(address: Address, day: string, origin: string, core: Address) {
  return ["Verifiable Blackbox: receive demo gas", `Origin: ${origin}`,
    "Chain: Ethereum Sepolia (11155111)", `Core: ${core.toLowerCase()}`,
    `Recipient: ${address.toLowerCase()}`, `UTC day: ${day}`,
    "Request a limited Sepolia ETH top-up for this wallet. No payment or token approval is authorized."].join("\n");
}

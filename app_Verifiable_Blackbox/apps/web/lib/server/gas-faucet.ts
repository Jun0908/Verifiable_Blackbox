import "server-only";
import {mkdir, open, readFile, rename, unlink, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createWalletClient, http, keccak256, parseEther, verifyMessage, type Address, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {gasFundingMessage, type GasStatus} from "@/lib/gas-funding";
import {assertDemoAutomationEnabled, getDemoChain, getDeployment, getPublicClient} from "./config";

const DAY_BUDGET = parseEther("0.05");
const MAX_TOP_UP = parseEther("0.01");
const RESERVE = parseEther("0.001");
type Claim = {day: string; address: Address; amount: string; hash: Hex; raw: Hex; state: "pending" | "confirmed" | "reverted"};
type Ledger = {claims: Claim[]};
const max = (a: bigint, b: bigint) => a > b ? a : b;
const today = () => new Date().toISOString().slice(0, 10);

function poolAccount() {
  if (process.env.DEMO_GAS_FAUCET_ENABLED !== "true" || !process.env.DEMO_GAS_FAUCET_PRIVATE_KEY) return undefined;
  return privateKeyToAccount(process.env.DEMO_GAS_FAUCET_PRIVATE_KEY as Hex);
}

function ledgerPath(address: Address) {
  return resolve(process.env.DEMO_GAS_DIR || ".demo-gas", `11155111-${address.toLowerCase()}`, "ledger.json");
}

async function readLedger(path: string): Promise<Ledger> {
  try {return JSON.parse(await readFile(path, "utf8")) as Ledger;}
  catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return {claims: []}; throw Error("GAS_LEDGER_UNAVAILABLE");}
}

async function saveLedger(path: string, ledger: Ledger) {
  await writeFile(path + ".tmp", JSON.stringify(ledger, null, 2), {mode: 0o600});
  await rename(path + ".tmp", path);
}

async function assertSepolia() {
  assertDemoAutomationEnabled();
  if (getDeployment().chainId !== 11155111 || await getPublicClient().getChainId() !== 11155111) throw Error("GAS_SEPOLIA_REQUIRED");
}

export async function gasStatus(address: Address, origin: string): Promise<GasStatus> {
  await assertSepolia();
  const client = getPublicClient();
  const [balance, fees] = await Promise.all([client.getBalance({address}), client.estimateFeesPerGas()]);
  // createAndFundDemo includes token minting and escrow creation. Allow a conservative gas ceiling.
  const required = max(parseEther("0.001"), 600_000n * fees.maxFeePerGas * 12n / 10n);
  const target = max(parseEther("0.003"), required * 2n);
  const day = today();
  const result: GasStatus = {chainId: 11155111, address, balanceWei: balance.toString(), requiredWei: required.toString(),
    targetWei: target.toString(), ready: balance >= required, available: false, day,
    message: gasFundingMessage(address, day, origin, getDeployment().erc8183)};
  const account = poolAccount();
  if (!account) return {...result, reason: "disabled"};
  const [poolBalance, ledger] = await Promise.all([client.getBalance({address: account.address}), readLedger(ledgerPath(account.address))]);
  const existing = ledger.claims.findLast(c => c.day === day && c.address.toLowerCase() === address.toLowerCase());
  const spent = ledger.claims.filter(c => c.day === day && c.state !== "reverted").reduce((sum, c) => sum + BigInt(c.amount), 0n);
  const amount = max(0n, target - balance);
  const reason: GasStatus["reason"] = ledger.claims.some(c => c.state === "pending") ? "pending"
    : existing?.state === "confirmed" ? "daily-limit" : target > MAX_TOP_UP ? "high-fees"
    : spent + amount > DAY_BUDGET ? "budget-limit" : poolBalance < amount + RESERVE ? "pool-empty" : undefined;
  return {...result, available: !reason, reason, poolAddress: account.address, poolBalanceWei: poolBalance.toString(), transactionHash: existing?.hash};
}

export async function claimGas(address: Address, day: unknown, signature: unknown, origin: string) {
  await assertSepolia();
  if (day !== today() || typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw Error("GAS_SIGNATURE_REQUIRED");
  const message = gasFundingMessage(address, day, origin, getDeployment().erc8183);
  if (!await verifyMessage({address, message, signature: signature as Hex})) throw Error("GAS_SIGNATURE_REQUIRED");
  const account = poolAccount();
  if (!account) throw Error("GAS_FAUCET_DISABLED");
  const path = ledgerPath(account.address);
  await mkdir(resolve(path, ".."), {recursive: true});
  let lock;
  try {lock = await open(path + ".lock", "wx", 0o600);} catch {throw Error("GAS_REQUEST_IN_PROGRESS");}
  try {
    const ledger = await readLedger(path);
    const client = getPublicClient();
    // Store the signed bytes before broadcasting. Retries always reuse the same transaction/nonce.
    async function settle(claim: Claim) {
      try {
        let receipt = await client.getTransactionReceipt({hash: claim.hash}).catch(() => undefined);
        if (!receipt) {
          await client.sendRawTransaction({serializedTransaction: claim.raw}).catch(() => {});
          receipt = await client.waitForTransactionReceipt({hash: claim.hash, timeout: 30_000});
        }
        claim.state = receipt.status === "success" ? "confirmed" : "reverted";
        await saveLedger(path, ledger);
      } catch {throw Error("GAS_TRANSACTION_PENDING");}
    }
    for (const pending of ledger.claims.filter(c => c.state === "pending")) await settle(pending);
    const status = await gasStatus(address, origin);
    if (status.ready) return {...status, gasTransactionHash: status.transactionHash ?? null};
    if (!status.available) throw Error(`GAS_${status.reason!.toUpperCase().replaceAll("-", "_")}`);
    const wallet = createWalletClient({account, chain: getDemoChain(), transport: http(process.env.DEMO_RPC_URL || process.env.SEPOLIA_RPC_URL)});
    const amount = BigInt(status.targetWei) - BigInt(status.balanceWei);
    const prepared = await wallet.prepareTransactionRequest({to: address, value: amount});
    if (prepared.gas * prepared.maxFeePerGas > RESERVE) throw Error("GAS_HIGH_FEES");
    const raw = await wallet.signTransaction(prepared);
    const claim: Claim = {day: today(), address, amount: amount.toString(), hash: keccak256(raw), raw, state: "pending"};
    ledger.claims.push(claim);
    await saveLedger(path, ledger);
    await settle(claim);
    if (claim.state === "reverted") throw Error("GAS_TRANSFER_REVERTED");
    return {...await gasStatus(address, origin), gasTransactionHash: claim.hash};
  } finally {await lock.close(); await unlink(path + ".lock");}
}

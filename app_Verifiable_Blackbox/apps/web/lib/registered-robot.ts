import {sha256, type Hex} from "viem";

// Public enrollment matched the device-exported key on Sepolia at block 11783311 (2026-09-26).
// This is not a live ENS lookup or proof that a particular job was device-signed.
const publicKey: Hex = "0x1b5befb889c3b13dd895a5d6b5e623c5e380dab097635c42dabf30cf02e7f57af4b96fa2c6c6d73debe31853df70ac327df2c4a81d5bd41e209058124eab8a0b";
export const registeredRobot = {
  chainId: 11155111,
  robotId: "rover-demo-001",
  ensName: "m5stack-rover-001.eth",
  recordUrl: "https://explorer.ens.dev/m5stack-rover-001.eth/records",
  keyId: sha256(publicKey),
  verifierUrl: "https://sepolia.etherscan.io/address/0x4E991Db4310835E3e2103E2417701a8CF296d2dd#code",
};

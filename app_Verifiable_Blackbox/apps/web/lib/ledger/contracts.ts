import {parseAbi} from "viem";
export const ledgerAbi = parseAbi([
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)",
  "event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount)",
  "event EvidenceCommitted(uint256 indexed jobId, bytes32 indexed evidenceCommitment)",
  "event DemoWorkReceiptIssued(bytes32 indexed receiptId, uint256 indexed jobId, address indexed provider, bytes32 evidenceCommitment, bytes32 verdictDigest, address verdictSigner)",
  "event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
]);
export const names = ["JobCreated", "JobFunded", "EvidenceCommitted", "DemoWorkReceiptIssued", "PaymentReleased", "Transfer"];

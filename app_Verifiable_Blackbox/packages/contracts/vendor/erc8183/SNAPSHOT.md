# ERC-8183 snapshot

- Specification: <https://eips.ethereum.org/EIPS/eip-8183>
- Canonical source: <https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8183.md>
- Retrieved: 2026-08-25
- Status at retrieval: Draft
- Solidity version: 0.8.28

`AgenticCommerce.sol` and `IACPHook.sol` are vendored from the reference implementation in the
canonical EIP. The MVP intentionally follows that reference implementation's callback payloads,
including the leading caller address used by lifecycle callbacks.

## Snapshot identity

These vendored source files are the pinned reference for this application (MIT SPDX headers retained). The historical upstream commit is not recorded; do not claim that today's EIP is byte-identical. Changes to this snapshot require explicit source review.

SHA-256 after normalizing CRLF to LF (stable across Git checkouts):

- AgenticCommerce.sol: `8a256674bafbf091bbbd5ecc6418994097132ebd371ce7383c9a0ec91b1b304f`
- IACPHook.sol: `608b3a3ac32c3935e85372025dd92b49a515c26536e35c7f8e27c6cf6d1e0d3d`

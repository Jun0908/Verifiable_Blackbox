// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC165Checker } from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import { AgenticCommerce } from "../vendor/erc8183/AgenticCommerce.sol";
import { IACPHook } from "../vendor/erc8183/IACPHook.sol";

interface IDemoMintableToken {
    function mint(address to, uint256 amount) external;
}

/// @notice Hackathon-only extension that starts a sponsored demo Job in one transaction.
/// @dev The ERC-8183 draft functions remain unchanged. This helper is only safe with MockUSDC
///      owned by this contract and must never be used with a token that has monetary value.
contract HackathonAgenticCommerce is AgenticCommerce {
    using SafeERC20 for IERC20;

    uint256 public constant DEMO_BUDGET = 100e6;

    /// @notice Creates a Job and places 100 Mock USDC in escrow atomically.
    /// @dev An existing exact approval is consumed first so old demo allowances become zero.
    ///      Otherwise the escrow receives freshly minted, valueless demo tokens.
    function createAndFundDemo(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external nonReentrant returns (uint256 jobId) {
        if (evaluator == address(0)) revert ZeroAddress();
        if (expiredAt <= block.timestamp + 5 minutes) revert ExpiryTooShort();
        if (!whitelistedHooks[hook]) revert HookNotWhitelisted();
        if (
            hook != address(0) && !ERC165Checker.supportsInterface(hook, type(IACPHook).interfaceId)
        ) revert InvalidJob();

        jobId = ++jobCounter;
        jobs[jobId] = Job({
            id: jobId,
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            description: description,
            budget: DEMO_BUDGET,
            expiredAt: expiredAt,
            status: JobStatus.Funded,
            hook: hook
        });
        jobHasBudget[jobId] = true;

        if (
            paymentToken.balanceOf(msg.sender) >= DEMO_BUDGET
                && paymentToken.allowance(msg.sender, address(this)) >= DEMO_BUDGET
        ) {
            paymentToken.safeTransferFrom(msg.sender, address(this), DEMO_BUDGET);
        } else {
            IDemoMintableToken(address(paymentToken)).mint(address(this), DEMO_BUDGET);
        }

        emit JobCreated(jobId, msg.sender, provider, evaluator, expiredAt, hook);
        emit BudgetSet(jobId, DEMO_BUDGET);
        emit JobFunded(jobId, msg.sender, DEMO_BUDGET);
        _afterHook(hook, jobId, msg.sig, abi.encode(msg.sender, provider, evaluator, DEMO_BUDGET));
    }
}

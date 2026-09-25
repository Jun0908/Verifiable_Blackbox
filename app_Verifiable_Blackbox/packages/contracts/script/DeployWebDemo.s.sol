// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { MockUSDC } from "../src/MockUSDC.sol";
import { DemoEvidenceHook } from "../src/DemoEvidenceHook.sol";
import { MockTeeEvaluator } from "../src/MockTeeEvaluator.sol";
import { HackathonAgenticCommerce } from "../src/HackathonAgenticCommerce.sol";
import { AgenticCommerce } from "../vendor/erc8183/AgenticCommerce.sol";

contract DeployWebDemo is Script {
    uint256 internal constant DEFAULT_DEPLOYER_PRIVATE_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant DEFAULT_PROVIDER_PRIVATE_KEY = 0xB0B;
    uint256 internal constant DEFAULT_RELAYER_PRIVATE_KEY = 0xD00D;
    uint256 internal constant DEFAULT_TEE_PRIVATE_KEY = 0xA11CE;

    function run() external {
        require(block.chainid == 31337, "Local Anvil only");
        uint256 deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", DEFAULT_DEPLOYER_PRIVATE_KEY);
        uint256 providerKey = vm.envOr("DEMO_PROVIDER_PRIVATE_KEY", DEFAULT_PROVIDER_PRIVATE_KEY);
        uint256 relayerKey = vm.envOr("DEMO_RELAYER_PRIVATE_KEY", DEFAULT_RELAYER_PRIVATE_KEY);
        uint256 teeKey = vm.envOr("DEMO_TEE_PRIVATE_KEY", DEFAULT_TEE_PRIVATE_KEY);
        address provider = vm.addr(providerKey);
        address relayer = vm.addr(relayerKey);
        address teeSigner = vm.addr(teeKey);

        vm.startBroadcast(deployerKey);
        _fundGas(provider);
        _fundGas(relayer);

        MockUSDC token = new MockUSDC(vm.addr(deployerKey));
        HackathonAgenticCommerce implementation = new HackathonAgenticCommerce();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(AgenticCommerce.initialize, (address(token), vm.addr(deployerKey)))
        );
        HackathonAgenticCommerce core = HackathonAgenticCommerce(address(proxy));
        DemoEvidenceHook hook = new DemoEvidenceHook(address(core));
        MockTeeEvaluator evaluator = new MockTeeEvaluator(address(core), address(hook), teeSigner);
        core.setHookWhitelist(address(hook), true);
        token.transferOwnership(address(core));
        vm.stopBroadcast();

        string memory objectKey = "web-demo";
        vm.serializeUint(objectKey, "chainId", block.chainid);
        vm.serializeAddress(objectKey, "mockUsdc", address(token));
        vm.serializeAddress(objectKey, "erc8183", address(core));
        vm.serializeAddress(objectKey, "evidenceHook", address(hook));
        vm.serializeAddress(objectKey, "evaluator", address(evaluator));
        vm.serializeAddress(objectKey, "provider", provider);
        vm.serializeAddress(objectKey, "relayer", relayer);
        string memory json = vm.serializeAddress(objectKey, "mockTeeSigner", teeSigner);
        vm.writeJson(json, "deployments/demo.web.json");

        console2.log("Web Demo contracts deployed");
        console2.log("MockUSDC", address(token));
        console2.log("ERC-8183 Core", address(core));
        console2.log("DemoEvidenceHook", address(hook));
        console2.log("MockTeeEvaluator", address(evaluator));
        console2.log("Provider", provider);
        console2.log("Relayer", relayer);
        console2.log("Mock TEE signer", teeSigner);
    }

    function _fundGas(address recipient) internal {
        (bool funded,) = recipient.call{ value: 2 ether }("");
        require(funded, "gas funding failed");
    }
}

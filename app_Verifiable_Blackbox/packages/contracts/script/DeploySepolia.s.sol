// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { MockUSDC } from "../src/MockUSDC.sol";
import { DemoEvidenceHook } from "../src/DemoEvidenceHook.sol";
import { MockTeeEvaluator } from "../src/MockTeeEvaluator.sol";
import { HackathonAgenticCommerce } from "../src/HackathonAgenticCommerce.sol";
import { AgenticCommerce } from "../vendor/erc8183/AgenticCommerce.sol";
import { DeviceSignatureVerifier } from "../../../parts/device-signature/contracts/DeviceSignatureVerifier.sol";

contract DeploySepolia is Script {
    uint256 internal constant PUBLIC_ANVIL_PRIVATE_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function run() external {
        require(block.chainid == 11155111, "Ethereum Sepolia only");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        require(deployerKey != 0 && deployerKey != PUBLIC_ANVIL_PRIVATE_KEY, "Unsafe deployer key");
        address provider = vm.envAddress("DEMO_PROVIDER_ADDRESS");
        address relayer = vm.envAddress("DEMO_RELAYER_ADDRESS");
        address teeSigner = vm.envAddress("DEMO_TEE_SIGNER_ADDRESS");
        require(provider != address(0) && relayer != address(0) && teeSigner != address(0), "Zero role address");

        vm.startBroadcast(deployerKey);
        MockUSDC token = new MockUSDC(vm.addr(deployerKey));
        HackathonAgenticCommerce implementation = new HackathonAgenticCommerce();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(AgenticCommerce.initialize, (address(token), vm.addr(deployerKey)))
        );
        HackathonAgenticCommerce core = HackathonAgenticCommerce(address(proxy));
        DemoEvidenceHook hook = new DemoEvidenceHook(address(core));
        MockTeeEvaluator evaluator = new MockTeeEvaluator(address(core), address(hook), teeSigner);
        DeviceSignatureVerifier deviceVerifier = new DeviceSignatureVerifier();
        core.setHookWhitelist(address(hook), true);
        token.transferOwnership(address(core));
        vm.stopBroadcast();

        string memory objectKey = "sepolia-demo";
        vm.serializeUint(objectKey, "chainId", block.chainid);
        vm.serializeAddress(objectKey, "mockUsdc", address(token));
        vm.serializeAddress(objectKey, "erc8183", address(core));
        vm.serializeAddress(objectKey, "erc8183Implementation", address(implementation));
        vm.serializeAddress(objectKey, "evidenceHook", address(hook));
        vm.serializeAddress(objectKey, "evaluator", address(evaluator));
        vm.serializeAddress(objectKey, "deviceSignatureVerifier", address(deviceVerifier));
        vm.serializeAddress(objectKey, "provider", provider);
        vm.serializeAddress(objectKey, "relayer", relayer);
        string memory json = vm.serializeAddress(objectKey, "mockTeeSigner", teeSigner);
        vm.writeJson(json, "deployments/demo.testnet.json");

        console2.log("Sepolia demo contracts deployed");
        console2.log("MockUSDC", address(token));
        console2.log("ERC-8183 implementation", address(implementation));
        console2.log("ERC-8183 core proxy", address(core));
        console2.log("DemoEvidenceHook", address(hook));
        console2.log("MockTeeEvaluator", address(evaluator));
        console2.log("DeviceSignatureVerifier", address(deviceVerifier));
    }
}

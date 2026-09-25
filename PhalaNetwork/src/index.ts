import { once } from "node:events";
import { ViemChainReader } from "./chain.js";
import { loadConfig } from "./config.js";
import { createSecurityProvider } from "./security.js";
import { createServer } from "./server.js";
import { VerifierService } from "./verify.js";
async function main() {
  const config = loadConfig();
  const security = await createSecurityProvider(config);
  const server = createServer(config, new VerifierService(config, new ViemChainReader(config), security), security);
  server.listen(config.port, config.host);
  await once(server, "listening");
  console.log(JSON.stringify({event: "server_started", port: config.port, mode: security.mode, signerAddress: security.address}));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return; stopping = true;
    const timer = setTimeout(() => {server.closeAllConnections();}, 5000).unref();
    server.close((error) => {clearTimeout(timer); process.exitCode = error ? 1 : 0;});
  };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
}
main().catch((error: unknown) => {
  const message = error instanceof Error && error.message.startsWith("Invalid configuration:") ? error.message : "SERVICE_INITIALIZATION_FAILED";
  console.error(JSON.stringify({event: "startup_failed", message})); process.exitCode = 1;
});

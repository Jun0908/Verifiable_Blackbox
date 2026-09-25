import { createServer as httpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { invalidRequest, normalizeError } from "./errors.js";
import type { Config } from "./config.js";
import type { SecurityProvider } from "./security.js";
import type { VerifierService } from "./verify.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(payload);
}
function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  if ((req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() !== "application/json")
    throw invalidRequest("CONTENT_TYPE_MUST_BE_JSON");
  if (Number(req.headers["content-length"] ?? 0) > maxBytes) throw invalidRequest("PAYLOAD_TOO_LARGE");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let length = 0; let failed = false;
    req.on("data", (chunk: Buffer) => {
      if (failed) return;
      length += chunk.length;
      if (length > maxBytes) { failed = true; chunks.length = 0; reject(invalidRequest("PAYLOAD_TOO_LARGE")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (failed) return;
      try { resolve(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(Buffer.concat(chunks)))); }
      catch { reject(invalidRequest("JSON_INVALID")); }
    });
    req.on("error", () => reject(invalidRequest("REQUEST_INTERRUPTED")));
    req.on("aborted", () => reject(invalidRequest("REQUEST_INTERRUPTED")));
  });
}
export function createServer(config: Config, verifier: VerifierService, security: SecurityProvider,
  log: (entry: Record<string, unknown>) => void = (entry) => console.log(JSON.stringify(entry))) {
  return httpServer({requestTimeout: 30_000, headersTimeout: 10_000}, async (req, res) => {
    const requestId = randomUUID(); const started = Date.now(); const method = req.method ?? "GET";
    let path = "/unknown"; let code: string | undefined;
    res.setHeader("x-request-id", requestId);
    try {
      let url: URL;
      try { url = new URL(req.url ?? "/", "http://localhost"); } catch { throw invalidRequest("URL_INVALID"); }
      if (["/health", "/verify", "/attestation"].includes(url.pathname)) path = url.pathname;
      if (method === "GET" && path === "/health") {
        sendJson(res, 200, {ok: true, service: "verifiable-blackbox-phala-verifier", verifier: {
          mode: security.mode, attested: security.attested, simulated: security.simulated,
          signerAddress: security.address, keySource: security.keySource, attestationPath: security.attestationAvailable ? "/attestation" : null,
        }});
      } else if (method === "GET" && path === "/attestation") {
        const values = url.searchParams.getAll("nonce"); const nonce = values[0];
        if (values.length > 1 || (nonce !== undefined && !/^[A-Za-z0-9._~-]{1,128}$/.test(nonce))) throw invalidRequest("ATTESTATION_NONCE_INVALID");
        sendJson(res, 200, {ok: true, ...await security.getAttestation(nonce)});
      } else if (method === "POST" && path === "/verify") {
        const body = await readJson(req, config.maxBodyBytes);
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("evidence" in body)) throw invalidRequest("EVIDENCE_REQUIRED");
        sendJson(res, 200, {ok: true, ...await verifier.verify(body.evidence)});
      } else {
        code = "INVALID_REQUEST";
        sendJson(res, 404, {ok: false, error: {code, reason: "NOT_FOUND", retryable: false}, requestId});
      }
    } catch (error) {
      const e = normalizeError(error); code = e.code;
      // Close after replying to an oversized or unread body. Never buffer it indefinitely.
      if (!req.complete) res.setHeader("connection", "close");
      if (!res.destroyed) sendJson(res, e.status, {ok: false, error: {code: e.code, reason: e.reason, retryable: e.retryable}, requestId});
      req.resume();
    } finally {
      log({requestId, method, path, status: res.statusCode, durationMs: Date.now() - started, ...(code ? {code} : {})});
    }
  });
}

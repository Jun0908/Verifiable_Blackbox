import "server-only";

export function errorResponse(error: unknown, fallback = "Demo request failed") {
  const raw = error instanceof Error ? error.message : fallback;
  // RPC libraries may include credential-bearing URLs and transaction payloads.
  const message = /^[A-Z][A-Z0-9_]+$/.test(raw)
    || /^(jobId|scenario|evidence[ .]|Unknown provider action|DEMO_)/.test(raw) ? raw : fallback;
  return Response.json(
    {ok: false, error: message},
    {status: 400, headers: {"Cache-Control": "no-store"}},
  );
}

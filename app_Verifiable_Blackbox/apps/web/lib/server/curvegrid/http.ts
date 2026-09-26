import "server-only";
import {safeError} from "./fetch";
export function requireLocal(request: Request, write = false) {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    || request.headers.get("sec-fetch-site") === "cross-site"
    || (write && request.headers.get("origin") !== `${url.protocol}//${host}`)) throw Error("ORIGIN");
}
export const json = (body: unknown, status = 200) => Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
export function failure(error: unknown) {
  if (error instanceof Error && error.message === "ORIGIN") return json({error:"ORIGIN"},403);
  const code = safeError(error);
  return json({error:code},code === "BUSY" ? 409 : code === "RATE_LIMIT" ? 429 : 503);
}

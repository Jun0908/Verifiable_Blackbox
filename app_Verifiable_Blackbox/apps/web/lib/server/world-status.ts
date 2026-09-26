import "server-only";

export async function worldConnectionStatus() {
  const {WORLD_SERVICE_URL: service, WORLD_PUBLIC_URL: publicUrl, WORLD_INTERNAL_TOKEN: token} = process.env;
  if (!service || !publicUrl || !token || token.length < 32) return {ready:false, error:"WORLD_NOT_CONFIGURED"};
  let base: URL, publicBase: URL;
  try {
    base = new URL(service); publicBase = new URL(publicUrl);
    for (const url of [base, publicBase]) {
      if (url.pathname !== "/" || url.search || url.hash || url.username || url.password
        || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw Error();
    }
  } catch {return {ready:false, error:"WORLD_CONFIGURATION_INVALID"};}
  try {
    const response = await fetch(new URL("/internal/health",base), {headers:{Authorization:`Bearer ${token}`}, cache:"no-store", redirect:"error", signal:AbortSignal.timeout(3000)});
    if (response.status === 403) return {ready:false, error:"WORLD_CREDENTIAL_MISMATCH"};
    if (!response.ok) return {ready:false, error:"WORLD_UNAVAILABLE"};
    const result = await response.json();
    if (result.service !== "vbb-world-disclosure" || result.base !== publicBase.origin) return {ready:false, error:"WORLD_CONFIGURATION_INVALID"};
    if (!result.ownersConfigured) return {ready:false, error:"WORLD_APPROVER_NOT_CONFIGURED"};
    try {
      const external = await fetch(new URL("/health",publicBase), {cache:"no-store", redirect:"error", signal:AbortSignal.timeout(5000)});
      if (!external.ok || (await external.json()).service !== "vbb-world-disclosure") throw Error();
    } catch {return {ready:false, error:"WORLD_PUBLIC_UNAVAILABLE"};}
    return {ready:true, mode:result.mode as string, sandbox:result.sandbox === true};
  } catch {return {ready:false, error:"WORLD_UNAVAILABLE"};}
}

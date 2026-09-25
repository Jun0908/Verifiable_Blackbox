import "server-only";
export function isLocalBridgeRequest(request:Request, mutation=false) {
  const host=request.headers.get('host');
  return Boolean(host && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    && !['cross-site','same-site'].includes(request.headers.get('sec-fetch-site') ?? '')
    && (!request.headers.get('origin') || request.headers.get('origin') === `http://${host}`)
    && (!mutation || request.headers.get('origin') === `http://${host}`));
}
export function bridgeUrl(path:string) {
  const base=new URL(process.env.VBB_BRIDGE_URL || 'http://127.0.0.1:8765');
  if(base.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(base.hostname) || base.username || base.password || base.pathname!=='/') throw Error('Bridge must use a loopback URL');
  return new URL(path,base).toString();
}

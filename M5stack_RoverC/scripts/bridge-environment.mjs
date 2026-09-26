// The device bridge needs no wallet, RPC or Phala credentials.
export function bridgeEnvironment(source) {
  const allowed=new Set(['path','systemroot','windir','temp','tmp','home','userprofile','localappdata',
    'appdata','lang','lc_all','rover_base_url','rover_api_token','rover_settings_file',
    'rover_required_wifi_profile','vbb_bridge_token','vbb_bridge_port']);
  return {...Object.fromEntries(Object.entries(source).filter(([key])=>allowed.has(key.toLowerCase()))),
    PYTHONUNBUFFERED:'1'};
}

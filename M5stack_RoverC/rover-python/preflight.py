"""Read-only readiness report. Never ARM, move, open serial ports, or flash."""
import argparse
import json
import re
from rover.config import PROJECT_DIR, app_settings, load_rover_settings


def private_header(path):
    if not path.exists(): return {}
    return dict(re.findall(r'^\s*#define\s+(ROVER_\w+)\s+"([^"\n]*)"',path.read_text(encoding='utf-8'),re.M))


def placeholder(value):
    return not value or value.startswith(('replace-','your-','change-me'))


def inspect(root=PROJECT_DIR.parent):
    environment=app_settings(require=False)
    rover=private_header(root/'m5stick-rover/include/secrets.h')
    camera=private_header(root/'camera-firmware/RoverCamera/secrets.h')
    settings=load_rover_settings()
    checks={
        'rover_url_configured': bool(environment.base_url and '192.0.2.' not in environment.base_url),
        'rover_token_configured': not placeholder(environment.token),
        'firmware_token_matches': bool(environment.token and environment.token==rover.get('ROVER_API_TOKEN')),
        'rover_home_ssid_configured': not placeholder(rover.get('ROVER_WIFI_SSID','')),
        'camera_home_ssid_configured': not placeholder(camera.get('ROVER_WIFI_SSID','')),
        'camera_token_matches': bool(environment.token and environment.token==camera.get('ROVER_API_TOKEN')),
        'camera_url_configured': bool(settings.camera_url),
    }
    return {'readyForConfigurationReview':all(checks.values()),'checks':checks,
            'hardwareTested':False,'physicalMovementVerified':False,'paymentEnabled':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ports',action='store_true',help='List USB/serial metadata without opening a port')
    parser.add_argument('--probe',action='store_true',help='Authenticated status reads only, on the configured LAN')
    args=parser.parse_args()
    report=inspect()
    if args.ports:
        from serial.tools.list_ports import comports
        report['serialPorts']=[{'port':p.device,'description':p.description,'vid':p.vid,'pid':p.pid} for p in comports()]
    if args.probe:
        from rover.api import RoverAPI
        try:
            settings=app_settings()
            status=RoverAPI(settings.base_url,settings.token).status()
            report['roverStatus']={key:status.get(key) for key in ('protocol','armed','i2c','motors','wifi','stop_reason')}
        except Exception:
            report['probeError']='Rover status unavailable; check local settings and network'
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if report['readyForConfigurationReview'] and 'probeError' not in report else 1


if __name__=='__main__':
    raise SystemExit(main())

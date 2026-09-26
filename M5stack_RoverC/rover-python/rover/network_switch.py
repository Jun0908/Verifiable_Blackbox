"""Explicitly move Windows and the devices to one selected Wi-Fi network."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time
from urllib.parse import urlparse

import requests

from .config import CONFIG_DIR, PROJECT_DIR, app_settings, load_rover_settings


class NetworkSwitchError(RuntimeError):
    pass


def private_defines(path: Path) -> dict[str, str]:
    """Read quoted C definitions without logging their values."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError:
        raise NetworkSwitchError(f"Missing private settings file: {path.name}") from None
    return {key: json.loads(value) for key, value in re.findall(
        r'^\s*#define\s+(ROVER_\w+)\s+("(?:[^"\\]|\\.)*")', text, re.MULTILINE)}


def network_settings() -> dict[str, str]:
    settings = private_defines(PROJECT_DIR.parent / "m5stick-rover/include/secrets.h")
    for key in ("ROVER_WIFI_SSID", "ROVER_HOTSPOT_SSID", "ROVER_API_TOKEN"):
        if not settings.get(key):
            raise NetworkSwitchError(f"Set {key} in the Rover secrets.h and flash the firmware first.")
    if settings["ROVER_WIFI_SSID"] == settings["ROVER_HOTSPOT_SSID"]:
        raise NetworkSwitchError("Home and hotspot must have different SSIDs for explicit switching.")
    return settings


class WindowsWifi:
    def _netsh(self, *args):
        if os.name != "nt":
            raise NetworkSwitchError("Automatic Wi-Fi selection requires Windows; connect manually and use USB network home/hotspot.")
        result = subprocess.run(["netsh", "wlan", *args], capture_output=True, timeout=15,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        # netsh can emit the Windows ANSI codepage even when Python uses UTF-8.
        for name in ("stdout", "stderr"):
            raw = getattr(result, name)
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                text = raw.decode("mbcs", errors="replace")
            setattr(result, name, text)
        return result

    def current(self) -> tuple[str, str]:
        result = self._netsh("show", "interfaces")
        ssid = re.search(r'^\s*SSID\s*:\s*(.+)$', result.stdout, re.MULTILINE)
        name = re.search(r'^\s*(?:Name|名前)\s*:\s*(.+)$', result.stdout, re.MULTILINE)
        return (ssid.group(1).strip() if ssid else "", name.group(1).strip() if name else "")

    def join(self, ssid: str) -> None:
        if self.current()[0] == ssid:
            return
        # The driver may briefly reject a request during the previous transition.
        for attempt in range(3):
            result = self._netsh("connect", "name=" + ssid, "ssid=" + ssid)
            if result.returncode == 0:
                break
            if attempt < 2:
                time.sleep(1)
        if result.returncode:
            raise NetworkSwitchError("Windows could not select the Wi-Fi profile. Connect to both networks once in Windows Wi-Fi settings first.")
        for _ in range(40):
            if self.current()[0] == ssid:
                try:
                    self.subnet(expected_ssid=ssid)
                    return
                except NetworkSwitchError:
                    pass  # Association can finish before DHCP and the NLA profile.
            time.sleep(0.5)
        raise NetworkSwitchError("Windows did not connect to the selected Wi-Fi. Check its saved profile and hotspot power.")

    def subnet(self, expected_ssid: str | None = None) -> ipaddress.IPv4Network:
        ssid, interface = self.current()
        if expected_ssid and ssid != expected_ssid:
            raise NetworkSwitchError("Waiting for the requested Wi-Fi SSID")
        env = os.environ.copy()
        env["ROVER_WIFI_INTERFACE"] = interface
        command = "$profile = Get-NetConnectionProfile -InterfaceAlias $env:ROVER_WIFI_INTERFACE; Get-NetIPAddress -InterfaceAlias $env:ROVER_WIFI_INTERFACE -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object IPAddress,PrefixLength,@{Name='NetworkName';Expression={$profile.Name}} | ConvertTo-Json -Compress"
        result = subprocess.run(["powershell", "-NoProfile", "-Command", command],
                                env=env, capture_output=True, text=True, timeout=15,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            data = json.loads(result.stdout)
            if isinstance(data, list):
                data = data[0]
            return ipaddress.ip_network(f"{data['IPAddress']}/{data['PrefixLength']}", strict=False)
        except (ValueError, KeyError, IndexError, TypeError):
            raise NetworkSwitchError("Windows has no usable IPv4 address on the selected Wi-Fi.") from None


class NetworkDevices:
    def __init__(self, token: str, wifi: WindowsWifi):
        self.token, self.wifi = token, wifi
        self.cache_path = CONFIG_DIR / "networks.local.json"
        try:
            self.cache = json.loads(self.cache_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.cache = {}

    def probe(self, host: str):
        try:
            with requests.Session() as session:
                session.trust_env = False
                response = session.get(f"http://{host}/network", headers={"X-Rover-Token": self.token}, timeout=1.5)
                if not response.ok:
                    return None
                data = response.json()
            if data.get("ok") is True and data.get("device") in {"rover", "camera"} and data.get("connected") is True:
                return {**data, "url": f"http://{host}"}
        except (requests.RequestException, ValueError):
            pass
        return None

    def find(self, profile: str, wanted: set[str]) -> dict[str, dict]:
        subnet = self.wifi.subnet()
        candidates = list(self.cache.get(profile, {}).values())
        candidates += [app_settings(require=False).base_url,
                       load_rover_settings(CONFIG_DIR / "rover.json").camera_url,
                       "http://roverc.local", "http://rover-camera.local"]
        hosts = set()
        names = []
        for url in candidates:
            try:
                host = urlparse(url).hostname or ""
                try:
                    ipaddress.ip_address(host)
                except ValueError:
                    if host:
                        names.append(host)
                    continue
                if ipaddress.ip_address(host) in subnet:
                    hosts.add(host)
            except (OSError, ValueError):
                pass
        found = {}

        def collect(targets):
            with ThreadPoolExecutor(max_workers=24) as pool:
                for result in pool.map(self.probe, targets):
                    if result and result["device"] in wanted:
                        found[result["device"]] = result

        for retry in range(3):
            collect(hosts)
            if wanted.issubset(found):
                break
            if hosts and retry < 2:
                time.sleep(0.5)
        # Known numeric addresses must not wait on .local DNS timeouts.
        if not wanted.issubset(found):
            resolved = set()
            for name in names:
                try:
                    host = socket.gethostbyname(name)
                    if ipaddress.ip_address(host) in subnet and host not in hosts:
                        resolved.add(host)
                except (OSError, ValueError):
                    pass
            collect(resolved)
            hosts.update(resolved)
        if not wanted.issubset(found):
            if subnet.num_addresses > 1024:
                raise NetworkSwitchError("Wi-Fi subnet is too large to scan. Set device URLs in config/networks.local.json.")
            collect(str(ip) for ip in subnet.hosts() if str(ip) not in hosts)
            if not wanted.issubset(found):
                collect(hosts)  # Retry candidates after ARP/DHCP has had time to settle.
        if found:
            self.cache.setdefault(profile, {}).update({kind: data["url"] for kind, data in found.items()})
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(self.cache, indent=2) + "\n", encoding="utf-8")
        return found

    def stop(self, device: dict) -> None:
        from .api import RoverAPI, RoverAPIError
        api = RoverAPI(device["url"], self.token)
        try:
            api.stop()
            status = api.request("GET", "/status")
            if status.get("armed") is not False or status.get("motors") is not False or status.get("i2c") is not True:
                raise NetworkSwitchError("Rover stop could not be confirmed; network unchanged")
        except RoverAPIError as exc:
            raise NetworkSwitchError("Rover stop could not be confirmed; network unchanged") from exc

    def select(self, device: dict, profile: str) -> None:
        if profile == "hotspot" and not device.get("hotspot_configured"):
            raise NetworkSwitchError(f"{device['device']}: hotspot settings are missing in the flashed firmware.")
        with requests.Session() as session:
            session.trust_env = False
            try:
                response = session.post(device["url"] + "/network", data={"profile": profile},
                                        headers={"X-Rover-Token": self.token}, timeout=3)
            except requests.RequestException:
                return  # Resolve a lost ACK by checking the destination network.
        if response.status_code != 202:
            raise NetworkSwitchError(f"{device['device']}: network switch rejected (HTTP {response.status_code}).")


def prepare_network(profile: str, settings: dict, *, rover_only=False,
                    wifi=None, devices=None, report=print) -> dict[str, dict]:
    if profile not in {"home", "hotspot"}:
        raise ValueError("Unknown network profile")
    wifi = wifi or WindowsWifi()
    devices = devices or NetworkDevices(settings["ROVER_API_TOKEN"], wifi)
    ssids = {"home": settings["ROVER_WIFI_SSID"], "hotspot": settings["ROVER_HOTSPOT_SSID"]}
    wanted = {"rover"} if rover_only else {"rover", "camera"}
    current_ssid, _ = wifi.current()
    current_profile = next((key for key, value in ssids.items() if value == current_ssid), None)
    if current_profile:
        source = devices.find(current_profile, wanted)
        if "rover" in source:
            devices.stop(source["rover"])
        for data in source.values():
            if data.get("profile") != profile:
                devices.select(data, profile)
    report(f"Selecting {profile} Wi-Fi on this PC...")
    wifi.join(ssids[profile])
    for attempt in range(3):
        found = devices.find(profile, wanted)
        ready = {kind: data for kind, data in found.items() if data.get("profile") == profile}
        if wanted.issubset(ready):
            report("Confirmed: PC and " + ", ".join(sorted(wanted)) + f" use {profile}.")
            return ready
        if attempt < 2:
            time.sleep(2)
    missing = ", ".join(sorted(wanted - ready.keys()))
    raise NetworkSwitchError(f"Not starting controls: {missing} is not confirmed on {profile}. Power it on and install the network-switch firmware by USB first. No home-network fallback is used.")

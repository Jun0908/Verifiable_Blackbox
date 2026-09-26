import os
import ipaddress
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from rover.api import RoverAPI, RoverAPIError
from rover.network_switch import NetworkDevices, NetworkSwitchError, WindowsWifi, prepare_network

SETTINGS = {"ROVER_WIFI_SSID": "Home", "ROVER_HOTSPOT_SSID": "Mobile", "ROVER_API_TOKEN": "dummy"}


class FakeWifi:
    def __init__(self):
        self.ssid, self.joins = "Mobile", []

    def join(self, ssid):
        self.ssid = ssid
        self.joins.append(ssid)

    def current(self):
        return self.ssid, 'Wi-Fi'


class FakeDevices:
    def __init__(self, wifi, locations):
        self.wifi, self.locations, self.selections = wifi, locations, []
        self.stops = []

    def stop(self, device):
        self.stops.append(device['device'])

    def find(self, profile, wanted):
        expected = "Mobile" if profile == "hotspot" else "Home"
        assert self.wifi.ssid == expected
        return {kind: {"device": kind, "profile": location, "url": "http://" + kind,
                       "hotspot_configured": True, "connected": True}
                for kind, location in self.locations.items() if location == profile and kind in wanted}

    def select(self, device, profile):
        self.selections.append((device["device"], profile))
        self.locations[device["device"]] = profile


class NetworkSwitchTests(unittest.TestCase):
    def test_known_device_ips_retry_without_waiting_for_mdns(self):
        wifi = SimpleNamespace(subnet=lambda: ipaddress.ip_network("10.42.48.0/24"))
        counts = {}
        def probe(host):
            counts[host] = counts.get(host, 0) + 1
            if host.endswith("114") and counts[host] == 1:
                return None
            kind = "camera" if host.endswith("114") else "rover"
            return {"device": kind, "profile": "hotspot", "url": "http://" + host}
        with tempfile.TemporaryDirectory() as folder, \
                patch("rover.network_switch.CONFIG_DIR", Path(folder)), \
                patch("rover.network_switch.app_settings", return_value=SimpleNamespace(base_url="")), \
                patch("rover.network_switch.load_rover_settings", return_value=SimpleNamespace(camera_url="")), \
                patch("rover.network_switch.socket.gethostbyname", side_effect=AssertionError("unnecessary DNS lookup")), \
                patch("rover.network_switch.time.sleep"):
            devices = NetworkDevices("dummy", wifi)
            devices.cache = {"hotspot": {"rover": "http://10.42.48.246", "camera": "http://10.42.48.114"}}
            with patch.object(devices, "probe", side_effect=probe):
                self.assertEqual(set(devices.find("hotspot", {"rover", "camera"})), {"rover", "camera"})

    def test_windows_join_waits_for_dhcp_profile_after_ssid_changes(self):
        wifi = WindowsWifi()
        with patch.object(wifi, "current", side_effect=[("Mobile", "Wi-Fi"), ("Home", "Wi-Fi"), ("Home", "Wi-Fi")]), \
                patch.object(wifi, "_netsh", return_value=SimpleNamespace(returncode=0)), \
                patch.object(wifi, "subnet", side_effect=[NetworkSwitchError("old IP"), ipaddress.ip_network("192.168.1.0/24")]) as subnet, \
                patch("rover.network_switch.time.sleep"):
            wifi.join("Home")
            self.assertEqual(subnet.call_count, 2)
            subnet.assert_called_with(expected_ssid="Home")

    def test_windows_display_name_is_not_confused_with_ssid(self):
        wifi = WindowsWifi()
        result = SimpleNamespace(stdout='{"IPAddress":"10.42.48.7","PrefixLength":24,"NetworkName":"Mobile"}')
        with patch.object(wifi, "current", return_value=("Home", "Wi-Fi")), \
                patch("rover.network_switch.subprocess.run", return_value=result):
            self.assertEqual(wifi.subnet(expected_ssid="Home"),ipaddress.ip_network('10.42.48.0/24'))

    def prepare(self, wifi, devices, profile="hotspot", **kwargs):
        with patch("rover.network_switch.time.sleep"):
            return prepare_network(profile, SETTINGS, wifi=wifi, devices=devices, report=lambda *_: None, **kwargs)

    def test_current_network_devices_are_stopped_then_moved(self):
        wifi = FakeWifi()
        wifi.ssid = 'Home'
        devices = FakeDevices(wifi, {"rover": "home", "camera": "home"})
        ready = self.prepare(wifi, devices)
        self.assertEqual(set(ready), {"rover", "camera"})
        self.assertEqual(wifi.joins, ["Mobile"])
        self.assertEqual(devices.stops, ['rover'])
        self.assertEqual(devices.locations, {"rover": "hotspot", "camera": "hotspot"})

    def test_missing_camera_never_triggers_another_network_search(self):
        wifi = FakeWifi()
        devices = FakeDevices(wifi, {"rover": "hotspot", "camera": "home"})
        with self.assertRaisesRegex(NetworkSwitchError, 'camera'):
            self.prepare(wifi, devices)
        self.assertEqual(devices.selections, [])
        self.assertEqual(wifi.joins, ['Mobile'])

    def test_missing_camera_never_silently_starts_partial_setup(self):
        wifi = FakeWifi()
        devices = FakeDevices(wifi, {"rover": "home"})
        with self.assertRaisesRegex(NetworkSwitchError, "camera"):
            self.prepare(wifi, devices)
        self.assertEqual(wifi.ssid, "Mobile")

    def test_explicit_rover_only_mode_is_allowed(self):
        wifi = FakeWifi()
        wifi.ssid = 'Home'
        devices = FakeDevices(wifi, {"rover": "home"})
        self.assertEqual(set(self.prepare(wifi, devices, rover_only=True)), {"rover"})

    def test_home_launcher_moves_both_back(self):
        wifi = FakeWifi()
        devices = FakeDevices(wifi, {"rover": "hotspot", "camera": "hotspot"})
        self.prepare(wifi, devices, "home")
        self.assertEqual(devices.locations, {"rover": "home", "camera": "home"})
        self.assertEqual(wifi.ssid, "Home")

    def test_switch_failure_keeps_current_pc_network(self):
        wifi = FakeWifi()
        wifi.ssid = 'Home'
        devices = FakeDevices(wifi, {"rover": "home", "camera": "home"})
        with patch.object(devices, "select", side_effect=NetworkSwitchError("rejected")):
            with self.assertRaises(NetworkSwitchError):
                self.prepare(wifi, devices)
        self.assertEqual(wifi.ssid, "Home")

    def test_stop_failure_does_not_switch_pc_or_devices(self):
        wifi=FakeWifi(); wifi.ssid='Home'
        devices=FakeDevices(wifi,{'rover':'home','camera':'home'})
        with patch.object(devices,'stop',side_effect=NetworkSwitchError('stop unconfirmed')):
            with self.assertRaises(NetworkSwitchError): self.prepare(wifi,devices)
        self.assertEqual(wifi.joins,[])
        self.assertEqual(devices.selections,[])

    def test_control_client_rejects_rover_on_wrong_profile(self):
        api = RoverAPI("http://example", "dummy")
        with patch.dict(os.environ, {"ROVER_REQUIRED_WIFI_PROFILE": "hotspot"}), \
                patch.object(api, "request", return_value={"profile": "home", "connected": True}) as request:
            with self.assertRaises(RoverAPIError):
                api.status()
            request.assert_called_once_with("GET", "/network")

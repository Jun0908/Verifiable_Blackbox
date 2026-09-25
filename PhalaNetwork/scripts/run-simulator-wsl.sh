#!/usr/bin/env bash
set -euo pipefail
# Run inside WSL/Linux. Installs nothing and uses an existing official simulator 0.5.3.
source_dir="${DSTACK_SIMULATOR_DIR:-$HOME/.phala-cloud/simulator/0.5.3}"
test -x "$source_dir/dstack-simulator"
command -v socat >/dev/null
task_dir="$(mktemp -d /tmp/vbb-dstack-test.XXXXXXXX)"
sim_pid=""; proxy_pid=""
cleanup() {
  if [[ -n "$proxy_pid" ]]; then kill "$proxy_pid" 2>/dev/null || true; wait "$proxy_pid" 2>/dev/null || true; fi
  if [[ -n "$sim_pid" ]]; then kill "$sim_pid" 2>/dev/null || true; wait "$sim_pid" 2>/dev/null || true; fi
  case "$task_dir" in /tmp/vbb-dstack-test.*) rm -rf -- "$task_dir";; esac
}
trap cleanup EXIT INT TERM
for name in dstack-simulator dstack.toml appkeys.json app-compose.json sys-config.json eventlog.json quote.hex; do
  cp "$source_dir/$name" "$task_dir/$name"
done
cd "$task_dir"
./dstack-simulator -c dstack.toml > simulator.log 2>&1 & sim_pid=$!
for attempt in {1..100}; do
  kill -0 "$sim_pid"
  if [[ -S "$task_dir/dstack.sock" ]]; then break; fi
  sleep 0.1
done
test -S "$task_dir/dstack.sock"
socat TCP-LISTEN:8091,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:"$task_dir/dstack.sock" > proxy.log 2>&1 & proxy_pid=$!
sleep 0.2
kill -0 "$proxy_pid"
echo 'Simulator ready: http://127.0.0.1:8091 (simulated, not hardware-verified). Press Ctrl+C to stop.'
wait "$proxy_pid"

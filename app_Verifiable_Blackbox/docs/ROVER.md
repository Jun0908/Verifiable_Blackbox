# Rover controls

`npm run demo:rover` starts Anvil, MOCK_TEE, a **simulated** Rover bridge and the Web UI. The simulation never contacts hardware. `npm run demo:rover-phala` adds Phala LOCAL_DEV; see [PHALA.md](PHALA.md) for the separate verifier project prerequisite.

For attended hardware operation, `npm run demo:rover-hardware` starts the local test chain and the Python bridge. Its default project is `../../M5stack_RoverC/rover-python`; override with `ROVER_PYTHON_ROOT`. Create that project's `.venv` and install its requirements first; `ROVER_PYTHON` can select a different interpreter. Configure robot Wi-Fi and credentials in that project's private settings. Close the Windows control application and keep the robot in view.

The launcher checks ports 3000, 8545, 3100 and 8765 and reports conflicts without stopping other processes. Overrides: `VBB_WEB_PORT`, `VBB_RPC_PORT`, `VBB_PHALA_PORT`, `VBB_BRIDGE_PORT`. A new random bridge token is generated for every launch and remains server-side. The Web and bridge bind to loopback. The bridge is idle until **Connect robot** is selected. An unavailable robot produces a connection error; startup does not ARM it.

Hold a direction at 35/60/85 speed; release to stop driving. Stop also disconnects. Page hide, blur and navigation send release/stop; the independent Python bridge enforces a 450 ms command lease, telemetry freshness, sequence order and I2C checks. End controls records an operation marker only after stop confirmation. A failed stop never records success. Free driving does not create a Job or payment.

Camera configuration and power use separate endpoints and never ARM the robot. Gripper open is one action, close requires continued holding, and release shares the driving sequence. Command acknowledgements are not proof of physical motion.

## Verification

`npm run test:rover` checks proxy authorization, session/sequence forwarding, malformed commands and camera frames. In the Python project run `.venv/Scripts/python.exe -m unittest discover -s tests -p 'test_web_*.py'` to exercise actual bridge logic with mocked hardware. No real motion is required. Browser evidence and remaining attended checks are recorded in [VALIDATION.md](VALIDATION.md).

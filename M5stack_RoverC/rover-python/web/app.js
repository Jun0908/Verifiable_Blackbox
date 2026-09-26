(() => {
"use strict";
const $ = id => document.getElementById(id);
const directions = [...document.querySelectorAll("[data-direction], [data-gripper]")];
const speeds = [...document.querySelectorAll("[data-speed]")];
const token = document.querySelector('meta[name="bridge-token"]').content;
let language = "en";
try { language = localStorage.getItem("rover-language") === "ja" ? "ja" : "en"; } catch {}
const words = {
en: {gripper:"Gripper",gripperOpen:"Release",gripperClose:"Hold to grab",gripperHint:"Hold to close gradually. Release the button at the position you want.",gripping:"Operating gripper",title:"Robot controls",connect:"Connect robot",connecting:"Connecting…",drive:"Drive",intro:"Close the Windows control app before connecting. Hold a direction to drive; release to stop.",turnLeft:"Rotate left",forward:"Forward",turnRight:"Rotate right",left:"Left",right:"Right",back:"Backward",stop:"Stop",speed:"Speed",slow:"Slow",normal:"Normal",fast:"Fast",stopHint:"The Stop button disconnects the robot. Connect again to resume.",details:"Connection details",response:"Robot response",motors:"Motor output",footer:"Local Wi-Fi control",ready:"Controls active",waiting:"Waiting for connection",sending:"Sending drive commands",stopping:"Stopping…",receiving:"Receiving",notReceived:"Not received",offline:"Server unavailable. Start Rover Web again.",other:"Robot is controlled in another window.",lost:"Connection lost. Reconnect to continue.",connectError:"Cannot connect. Check robot power and Wi-Fi.",desktop:"Close the Windows app, then reconnect.",network:"Local network access is blocked. Restart the launcher with LAN access.",paused:"Press a direction again to continue.",stopError:"Stop could not be confirmed. Check the robot."},
ja: {gripper:"アーム",gripperOpen:"はなす",gripperClose:"つかむ（長押し）",gripperHint:"押している間だけ少しずつ閉じます。つかんだらボタンを離してください。",gripping:"アーム操作中",title:"ロボット操作",connect:"ロボットに接続",connecting:"接続中…",drive:"走行",intro:"接続前にWindows版の操作アプリを閉じてください。方向ボタンを押している間だけ進み、離すと止まります。",turnLeft:"左回転",forward:"まっすぐ",turnRight:"右回転",left:"左",right:"右",back:"うしろ",stop:"停止",speed:"速度",slow:"ゆっくり",normal:"ふつう",fast:"速め",stopHint:"停止ボタンを押すと切断します。再開するときは、もう一度接続してください。",details:"接続の詳細",response:"ロボットの応答",motors:"モーター出力",footer:"ローカルWi-Fi操作",ready:"操作受付中",waiting:"接続待ち",sending:"走行指令を送信中",stopping:"停止中…",receiving:"受信中",notReceived:"未受信",offline:"サーバーに接続できません。Web操作を起動し直してください。",other:"別の画面で操作中です。",lost:"接続が切れました。再接続してください。",connectError:"接続できません。電源とWi-Fiを確認してください。",desktop:"Windowsアプリを閉じて再接続してください。",network:"LAN通信が制限されています。LAN接続を許可して起動し直してください。",paused:"方向ボタンをもう一度押すと続けられます。",stopError:"停止を確認できません。ロボットを確認してください。"}
};
const t = key => words[language][key];
let session = null, sequence = 0, held = null, speed = 35, state = null;
let connecting = false, releasing = false, stopping = false, driving = false, polling = false;
let epoch = 0, pollVersion = 0, errorKey = "";
const active = () => ["connecting","ready","commanding","stopping"].includes(state?.state);
const canDrive = () => Boolean(session && !connecting && !releasing && !stopping && state?.telemetryFresh && ["ready","commanding"].includes(state.state));
function render() {
  document.documentElement.lang = language;
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  $("en").setAttribute("aria-pressed", String(language === "en"));
  $("ja").setAttribute("aria-pressed", String(language === "ja"));
  $("connect").textContent = t(connecting ? "connecting" : "connect");
  $("connect").disabled = connecting || stopping || active();
  $("stop").disabled = !session || (!active() && !connecting && !stopping);
  directions.forEach(el => { el.disabled = !canDrive(); el.setAttribute("aria-pressed", String(held === (el.dataset.direction || "grip-close"))); });
  $("gripper-open").disabled = !canDrive() || Boolean(held);
  speeds.forEach(el => { el.disabled = Boolean(held); el.setAttribute("aria-pressed", String(speed === Number(el.dataset.speed))); });
  const key = connecting ? "connecting" : stopping || state?.state === "stopping" ? "stopping" : held ? (held.startsWith("grip-") ? "gripping" : "sending") : canDrive() ? "ready" : active() && !session ? "other" : "waiting";
  $("status").textContent = t(key);
  document.querySelector(".connection").classList.toggle("online", canDrive());
  $("response").textContent = t(state?.telemetryFresh ? "receiving" : "notReceived");
  $("motors").textContent = state?.telemetryFresh && state.motors ? state.motors.join(" / ") : "—";
  $("wifi").textContent = state?.telemetryFresh && state.rssi != null ? state.rssi + " dBm" : "—";
  $("error").hidden = !errorKey;
  $("error").textContent = errorKey ? t(errorKey) : "";
}
function errorType(error, fallback) {
  const text = String(error.message);
  return text.includes("network access is blocked") ? "network" : text.includes("Windows") ? "desktop" : /Controls paused|Stale command/.test(text) ? "paused" : fallback;
}
async function request(path, body, keepalive = false) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET", cache:"no-store", keepalive,
    headers: {"Authorization":"Bearer " + token, "Content-Type":"application/json"},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(path === "/activate" ? 15000 : 5000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
async function release() {
  const hadDirection = Boolean(held);
  held = null;
  if (!session || releasing || stopping || (!hadDirection && !state?.controlPaused)) { render(); return; }
  releasing = true;
  const ownEpoch = epoch;
  ++pollVersion;
  try {
    const result = await request("/release", {session, sequence:++sequence}, true);
    if (epoch === ownEpoch) state = result;
  } catch (e) { if (epoch === ownEpoch) errorKey = errorType(e, "lost"); }
  finally { if (epoch === ownEpoch) { releasing = false; render(); } }
}
async function stop() {
  held = null;
  ++epoch; ++pollVersion;
  releasing = false;
  if (!session) { render(); return; }
  stopping = true;
  state = {...state, state:"stopping", telemetryFresh:false};
  render();
  try { state = await request("/stop", {session}, true); }
  catch { errorKey = "stopError"; }
  finally { stopping = false; render(); }
}
async function connect() {
  if (connecting || stopping || active()) return;
  connecting = true; errorKey = ""; render();
  const ownEpoch = ++epoch;
  ++pollVersion;
  try {
    const result = await request("/activate", {});
    session = result.session; sequence = 0;
    if (ownEpoch !== epoch || document.hidden) { await stop(); return; }
    state = result;
  } catch(e) { errorKey = errorType(e, "connectError"); }
  finally { connecting = false; render(); }
}
async function sendDrive() {
  if (!held || !canDrive() || driving) return;
  driving = true;
  const ownEpoch = epoch, nextSequence = ++sequence;
  try {
    const input = held;
    await request(input.startsWith("grip-") ? "/gripper" : "/drive",
      input.startsWith("grip-") ? {session, sequence:nextSequence, action:input.slice(5)}
        : {session, sequence:nextSequence, direction:input, speed});
    if (ownEpoch === epoch && held === "grip-open" && nextSequence === sequence) held = null;
  } catch(e) {
    if (ownEpoch === epoch && held && nextSequence === sequence) {
      errorKey = errorType(e, "lost");
      void release();
    }
  } finally { driving = false; render(); }
}
function begin(direction) {
  if (!canDrive() || held) return;
  errorKey = ""; held = direction; render(); void sendDrive();
}
async function poll() {
  if (polling) return;
  polling = true;
  const version = pollVersion;
  try {
    const next = await request("/status");
    if (version !== pollVersion) return;
    state = next;
    if (state.controlPaused && held) void release();
    if (!["ready","commanding"].includes(state.state)) held = null;
    if (state.state === "idle" && !connecting) session = null;
    if (state.state === "error" && session && !errorKey) errorKey = "lost";
  } catch {
    if (version !== pollVersion) return;
    state = null; errorKey = "offline";
    if (held) void release();
    held = null;
  } finally { polling = false; render(); }
}
directions.forEach(button => {
  const direction = button.dataset.direction || "grip-close";
  button.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    button.setPointerCapture(e.pointerId);
    begin(direction);
  });
  for (const event of ["pointerup","pointercancel","lostpointercapture","blur"])
    button.addEventListener(event, () => { if (held === direction) void release(); });
  button.addEventListener("keydown", e => {
    if ([" ","Enter"].includes(e.key)) { e.preventDefault(); if (!e.repeat) begin(direction); }
  });
  button.addEventListener("keyup", e => {
    if ([" ","Enter"].includes(e.key)) { e.preventDefault(); if (held === direction) void release(); }
  });
  button.addEventListener("contextmenu", e => e.preventDefault());
});
speeds.forEach(button => button.addEventListener("click", () => { speed = Number(button.dataset.speed); render(); }));
for (const lang of ["en","ja"]) $(lang).addEventListener("click", () => {
  language = lang;
  try { localStorage.setItem("rover-language", lang); } catch {}
  render();
});
$("gripper-open").addEventListener("click", () => begin("grip-open"));
$("connect").addEventListener("click", () => void connect());
$("stop").addEventListener("click", () => void stop());
window.addEventListener("blur", () => void release());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { void stop(); }
});
window.addEventListener("pagehide", () => void stop());
setInterval(() => void sendDrive(), 120);
setInterval(() => void poll(), 300);
render(); void poll();
})();

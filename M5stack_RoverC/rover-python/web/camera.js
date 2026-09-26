(() => {
"use strict";
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="bridge-token"]').content;
const words = {
 en:{title:"Camera",settings:"Camera settings",address:"Camera address",save:"Connect & save",waiting:"Connecting to camera…",unconfigured:"Set the camera address below.",live:"LIVE",saving:"Saving…",failed:"Could not save. Check the camera address.",saved:"Saved.",image:"Live rover camera",cameraSwitch:"Camera",off:"Camera OFF",recordHint:"Record OFF saves a WebM video in rover-python/recordings. Leaving this tab stops recording.",download:"Save recording again",unsupported:"Recording is not supported in this browser.",recordFailed:"Recording failed. Please try again.",recordSaved:"Saved",saveFailed:"Could not save to the recordings folder. Use the download link.",stopping:"Preparing video…"},
 ja:{title:"カメラ",settings:"カメラ設定",address:"カメラのアドレス",save:"接続・保存",waiting:"カメラへ接続中…",unconfigured:"下の設定からカメラのアドレスを入力してください。",live:"ライブ映像",saving:"保存中…",failed:"保存できません。カメラのアドレスを確認してください。",saved:"保存しました。",image:"ロボットのカメラ映像",cameraSwitch:"カメラ",off:"カメラ OFF",recordHint:"Record OFFで動画（WebM）をrover-python/recordingsに保存します。このタブを離れると録画を停止します。",download:"録画をもう一度保存",unsupported:"このブラウザでは録画に対応していません。",recordFailed:"録画できませんでした。もう一度お試しください。",recordSaved:"保存しました",saveFailed:"録画フォルダに保存できませんでした。下のリンクから保存してください。",stopping:"動画を準備中…"}
};
let configured = true, enabled = true, busy = false, saving = false, notice = "";
let frameId = "", lastFrameAt = 0, objectUrl = null, generation = 0;
let recorder = null, recording = false, finishing = false, startedAt = 0, recordNotice = "";
let savedVideoUrl = null, savedFilename = "";
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
const mime = typeof MediaRecorder === "undefined" ? "" :
 ["video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"].find(type => MediaRecorder.isTypeSupported(type)) || "";
const canRecord = !!(mime && canvas.captureStream && context);
const text = key => words[document.documentElement.lang === "ja" ? "ja" : "en"][key];
const live = () => enabled && lastFrameAt > 0 && Date.now() - lastFrameAt < 2000;
const elapsed = () => {
 const seconds = Math.floor((Date.now() - startedAt) / 1000);
 return String(Math.floor(seconds / 60)).padStart(2,"0") + ":" + String(seconds % 60).padStart(2,"0");
};
function render() {
 document.querySelectorAll("[data-camera-i18n]").forEach(el => {el.textContent = text(el.dataset.cameraI18n);});
 $("camera-image").hidden = !live();
 $("camera-empty").hidden = live();
 const state = !enabled ? "off" : configured ? "waiting" : "unconfigured";
 $("camera-empty").textContent = text(state);
 $("camera-state").textContent = recording ? "● REC " + elapsed() : text(live() ? "live" : state);
 $("camera-state").classList.toggle("live", live());
 $("camera-state").classList.toggle("recording", recording);
 $("camera-image").alt = text("image");
 $("camera-save").disabled = saving || recording || finishing;
 $("camera-url").disabled = saving || recording || finishing;
 $("camera-notice").textContent = notice ? text(notice) : "";
 for (const [id, pressed] of [["camera-on",enabled],["camera-off",!enabled],["record-on",recording],["record-off",!recording]]) {
  $(id).setAttribute("aria-pressed",String(pressed));
 }
 $("camera-on").disabled = saving || enabled;
 $("camera-off").disabled = saving || !enabled;
 $("record-on").disabled = !canRecord || !live() || saving || recording || finishing;
 $("record-off").disabled = !recording;
 $("record-status").textContent = recording ? "● REC " + elapsed() : finishing ? text("stopping") :
  !canRecord ? text("unsupported") : recordNotice ? text(recordNotice) + (recordNotice === "recordSaved" ? ": " + savedFilename : "") : "";
 $("record-status").classList.toggle("recording",recording);
}
function stopRecording() {
 if (!recording || !recorder) return;
 recording = false; finishing = true;
 if (recorder.state !== "inactive") recorder.stop();
 render();
}
function clearFrame() {
 stopRecording();
 lastFrameAt = 0; frameId = "";
 $("camera-image").removeAttribute("src");
 if (objectUrl) URL.revokeObjectURL(objectUrl);
 objectUrl = null; render();
}
function startRecording() {
 if (!canRecord || !live() || recording || finishing || saving) return;
 let stream;
 try {
  const img = $("camera-image");
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  context.drawImage(img,0,0,canvas.width,canvas.height);
  stream = canvas.captureStream(10);
  const current = new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1500000});
  const chunks = [];
  let bytes = 0, failed = false;
  const filename = "rover-" + new Date().toISOString().replace(/[:.]/g,"-") + ".webm";
  current.ondataavailable = event => {
   if (event.data.size) {chunks.push(event.data); bytes += event.data.size;}
   if (bytes >= 120 * 1024 * 1024) stopRecording();
  };
  current.onerror = () => {failed = true; recordNotice = "recordFailed"; stopRecording();};
  current.onstop = async () => {
   stream.getTracks().forEach(track => track.stop());
   recorder = null; recording = false;
   if (bytes) {
    if (savedVideoUrl) URL.revokeObjectURL(savedVideoUrl);
    const video = new Blob(chunks,{type:current.mimeType});
    savedVideoUrl = URL.createObjectURL(video);
    const link = $("record-download");
    link.href = savedVideoUrl; link.download = filename; link.hidden = false;
    try {
     const response = await fetch("/camera/recordings", {
      method:"POST", headers:{Authorization:"Bearer " + token,"Content-Type":"video/webm"},
      body:video, signal:AbortSignal.timeout(60000)
     });
     if (!response.ok) throw Error("Recording save failed");
     savedFilename = (await response.json()).filename;
     recordNotice = failed ? "recordFailed" : "recordSaved";
    } catch {recordNotice = "saveFailed";}
   } else {recordNotice = "recordFailed";}
   finishing = false; render();
  };
  recorder = current;
  current.start(1000);
  recording = true; startedAt = Date.now(); recordNotice = "";
 } catch {
  if (stream) stream.getTracks().forEach(track => track.stop());
  recorder = null; recording = false; finishing = false; recordNotice = "recordFailed";
 }
 render();
}
async function api(path, body) {
 const response = await fetch(path,{method:body ? "POST" : "GET",cache:"no-store",
  headers:{Authorization:"Bearer " + token,"Content-Type":"application/json"},
  body:body ? JSON.stringify(body) : undefined,signal:AbortSignal.timeout(3000)});
 if (!response.ok) throw Error("Camera request failed");
 return response;
}
async function loadSettings() {
 if (saving) return;
 const epoch = generation;
 try {
  const info = await (await api("/camera")).json();
  if (epoch !== generation || saving) return;
  configured = info.configured; enabled = info.enabled !== false;
  if (!enabled) {++generation; clearFrame();}
  if (!$("camera-url").value) $("camera-url").value = info.url;
 } catch {}
 render();
}
async function refresh() {
 if (busy || saving || !enabled || !configured || document.hidden) return;
 busy = true;
 const epoch = generation;
 let candidateUrl = null;
 try {
  const response = await api("/camera/frame");
  if (epoch !== generation || document.hidden) return;
  if (response.status === 204) {clearFrame(); return;}
  const stamp = response.headers.get("X-Camera-Frame");
  if (stamp === frameId) return;
  const blob = await response.blob();
  if (blob.type !== "image/jpeg") throw Error("Invalid camera image");
  candidateUrl = URL.createObjectURL(blob);
  const candidate = new Image();
  candidate.src = candidateUrl;
  await candidate.decode();
  if (epoch !== generation || document.hidden) return;
  if (recording) context.drawImage(candidate,0,0,canvas.width,canvas.height);
  const previous = objectUrl;
  objectUrl = candidateUrl; candidateUrl = null;
  $("camera-image").src = objectUrl;
  frameId = stamp; lastFrameAt = Date.now(); configured = true;
  if (previous) URL.revokeObjectURL(previous);
 } catch {
  if (epoch === generation) clearFrame();
 } finally {
  if (candidateUrl) URL.revokeObjectURL(candidateUrl);
  busy = false; render();
 }
}
async function setEnabled(value) {
 if (saving) return;
 saving = true; ++generation; clearFrame();
 try {
  const info = await (await api("/camera/power",{enabled:value})).json();
  enabled = info.enabled; configured = info.configured; notice = "";
 } catch {notice = "failed";}
 finally {saving = false; render();}
}
$("camera-on").addEventListener("click",() => void setEnabled(true));
$("camera-off").addEventListener("click",() => void setEnabled(false));
$("record-on").addEventListener("click",startRecording);
$("record-off").addEventListener("click",stopRecording);
$("camera-save").addEventListener("click", async () => {
 if (saving || recording || finishing) return;
 saving = true; notice = "saving"; ++generation; clearFrame();
 try {
  const info = await (await api("/camera", {url:$("camera-url").value})).json();
  configured = info.configured; enabled = info.enabled !== false;
  $("camera-url").value = info.url; notice = "saved";
 } catch {notice = "failed";}
 finally {saving = false; render();}
});
for (const id of ["en","ja"]) $(id).addEventListener("click", render);
document.addEventListener("visibilitychange", () => {
 ++generation; clearFrame();
 if (!document.hidden) {void loadSettings(); void refresh();}
});
window.addEventListener("beforeunload", event => {
 if (recording || finishing) {event.preventDefault(); event.returnValue = "";}
});
window.addEventListener("pagehide", () => {++generation; clearFrame();});
setInterval(() => {
 if (lastFrameAt && Date.now() - lastFrameAt >= 2000) clearFrame();
 if (recording && Date.now() - startedAt >= 10 * 60 * 1000) stopRecording();
 render();
}, 250);
setInterval(() => void refresh(), 150);
setInterval(() => {if (!document.hidden) void loadSettings();}, 1000);
render(); void loadSettings(); void refresh();
})();


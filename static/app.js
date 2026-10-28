import { GestureController } from "./gesture-controller.mjs";
import { SAMPLE_SLIDES, SlideDeck } from "./gallery.mjs";
import { HandFlipController } from "./hand-flip-controller.mjs";
import { FistController } from "./fist-controller.mjs";
import { TwoHandController } from "./two-hand-controller.mjs";

const $ = (selector) => document.querySelector(selector);
const video = $("#video");
const canvas = $("#overlay");
const ctx = canvas.getContext("2d");
const startButton = $("#start");
const stopButton = $("#stop");
const status = $("#status");
const badge = $("#badge");
const image = $("#slide-image");
const deck = new SlideDeck();
const gestures = new GestureController();
const handFlips = new HandFlipController();
const fists = new FistController();
const twoHands = new TwoHandController();
const VERSION = "0.10.21";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const poseLabels = { palm: "張開手掌，左右移動即可換圖", index: "食指：停留約半秒，跳至第一張", pinky: "小指：停留約半秒，跳至最後一張", none: "請張開手掌，或單獨伸出食指／小指" };
const actionLabels = { first: "第一張", last: "最後一張", previous: "上一張", next: "下一張" };
const connections = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15],
  [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
let recognizer;
let loadingPromise;
let stream;
let running = false;
let session = 0;
let frameId;
let lastVideoTime = -1;
let lastInference = -Infinity;
let localUrls = [];

function renderView() {
  const { scale, rotation } = deck.view;
  const viewport = $("#image-viewport");
  const previousAngle = Number.parseFloat(viewport.style.getPropertyValue("--image-rotation")) || 0;
  const angleDelta = ((rotation - previousAngle + 180) % 360 + 360) % 360 - 180;
  viewport.style.setProperty("--image-scale", String(scale));
  // Keep CSS angles continuous when the stored angle wraps across +/-180°.
  viewport.style.setProperty("--image-rotation", `${previousAngle + angleDelta}deg`);
  $("#view-state").textContent = `${Math.round(scale * 100)}% · ${Math.round(rotation)}°`;
  $("#zoom-in").disabled = scale >= 3 - 0.002;
  $("#zoom-out").disabled = scale <= 1 + 0.002;
  $("#reset-view").disabled = Math.abs(scale - 1) < 0.002 && Math.abs(rotation) < 0.15;
}

function renderSlide() {
  const slide = deck.slides[deck.index];
  if (image.getAttribute("src") !== slide.src) {
    $("#image-error").hidden = true;
    image.src = slide.src;
  } else {
    $("#image-error").hidden = !(image.complete && image.naturalWidth === 0);
  }
  image.alt = slide.title;
  image.classList.toggle("is-mirrored", deck.isMirrored);
  image.classList.toggle("is-vertically-mirrored", deck.isVerticallyMirrored);
  $("#mirror-button").setAttribute("aria-pressed", String(deck.isMirrored));
  $("#vertical-mirror-button").setAttribute("aria-pressed", String(deck.isVerticallyMirrored));
  const directions = [deck.isMirrored && "左右鏡像", deck.isVerticallyMirrored && "上下鏡像"].filter(Boolean);
  $("#mirror-state").textContent = `目前：${directions.length ? directions.join("＋") : "原始方向"}`;
  renderView();
  $("#slide-title").textContent = slide.title;
  $("#slide-description").textContent = slide.description;
  $("#slide-counter").textContent = `${String(deck.index + 1).padStart(2, "0")} / ${String(deck.slides.length).padStart(2, "0")}`;
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.disabled = ["first", "previous"].includes(button.dataset.action)
      ? deck.index === 0 : deck.index === deck.slides.length - 1;
  });
  document.querySelectorAll(".slide-dot").forEach((dot, index) => {
    dot.setAttribute("aria-current", String(index === deck.index));
  });
}

function announceSlide(prefix = "") {
  $("#navigation-status").textContent = `${prefix}第 ${deck.index + 1} 張，共 ${deck.slides.length} 張。`;
}

function navigate(action, source = "button") {
  fists.suppress(performance.now());
  twoHands.suppress(performance.now());
  if (source !== "gesture") {
    gestures.suppress(performance.now());
    handFlips.suppress(performance.now());
  }
  const changed = deck.navigate(action);
  renderSlide();
  let message = `${source === "gesture" ? "手勢" : ""}${actionLabels[action]}：`;
  if (!changed) message = deck.index === 0 ? "已是第一張。" : "已是最後一張。";
  announceSlide(message);
}

function mirrorImage(source = "button", axis = "horizontal") {
  const now = performance.now();
  gestures.suppress(now);
  handFlips.suppress(now);
  fists.suppress(now);
  twoHands.suppress(now);
  const vertical = axis === "vertical";
  const mirrored = vertical ? deck.toggleVerticalMirror() : deck.toggleMirror();
  renderSlide();
  const direction = vertical ? "上下" : "左右";
  const prefix = source === "gesture" ? (vertical ? "握拳手勢：" : "翻手手勢：") : "";
  announceSlide(`${prefix}${mirrored ? `圖片已${direction}翻轉。` : `圖片已還原${direction}方向。`}`);
}

$("#mirror-button").addEventListener("click", () => mirrorImage());
$("#vertical-mirror-button").addEventListener("click", () => mirrorImage("button", "vertical"));

function adjustView({ scaleDelta = 0, rotationDelta = 0, reset = false }) {
  const now = performance.now();
  gestures.suppress(now);
  handFlips.suppress(now);
  fists.suppress(now);
  twoHands.suppress(now);
  if (reset) deck.resetView();
  else {
    const view = deck.view;
    deck.setView({ scale: view.scale + scaleDelta, rotation: view.rotation + rotationDelta });
  }
  renderView();
  announceSlide(`圖片大小 ${Math.round(deck.view.scale * 100)}%，角度 ${Math.round(deck.view.rotation)}°。`);
}

$("#zoom-in").addEventListener("click", () => adjustView({ scaleDelta: 0.25 }));
$("#zoom-out").addEventListener("click", () => adjustView({ scaleDelta: -0.25 }));
$("#rotate-left").addEventListener("click", () => adjustView({ rotationDelta: -15 }));
$("#rotate-right").addEventListener("click", () => adjustView({ rotationDelta: 15 }));
$("#reset-view").addEventListener("click", () => adjustView({ reset: true }));

function buildDots() {
  $("#slide-dots").replaceChildren(...deck.slides.map((slide, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "slide-dot";
    dot.setAttribute("aria-label", `第 ${index + 1} 張：${slide.title}`);
    dot.addEventListener("click", () => {
      gestures.suppress(performance.now());
      handFlips.suppress(performance.now());
      fists.suppress(performance.now());
      twoHands.suppress(performance.now());
      deck.index = index;
      renderSlide();
      announceSlide();
    });
    return dot;
  }));
}

image.addEventListener("error", () => { $("#image-error").hidden = false; });
image.addEventListener("load", () => { $("#image-error").hidden = true; });
document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => navigate(button.dataset.action));
});
document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest("input, textarea, select, [contenteditable=true]")) return;
  const action = { ArrowLeft: "previous", ArrowRight: "next", Home: "first", End: "last" }[event.key];
  if (!action) return;
  event.preventDefault();
  navigate(action, "keyboard");
});

function revokeLocalImages() {
  localUrls.forEach((url) => URL.revokeObjectURL(url));
  localUrls = [];
}

$("#choose-images").addEventListener("click", () => $("#image-files").click());
$("#image-files").addEventListener("change", (event) => {
  const selected = [...event.target.files];
  if (!selected.length) return;
  const supported = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
  const files = selected.filter((file) => supported.has(file.type))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }));
  if (!files.length) {
    $("#upload-status").textContent = "請選擇 JPG、PNG、WebP、GIF 或 AVIF 圖片。";
    event.target.value = "";
    return;
  }
  const slides = files.map((file) => ({ src: URL.createObjectURL(file), title: file.name, description: "本機圖片 · 依檔名排序 · 不會上傳" }));
  revokeLocalImages();
  localUrls = slides.map((slide) => slide.src);
  deck.setSlides(slides);
  gestures.suppress(performance.now());
  handFlips.reset();
  handFlips.suppress(performance.now());
  fists.reset();
  fists.suppress(performance.now());
  twoHands.reset();
  twoHands.suppress(performance.now());
  $("#collection-label").textContent = "我的圖片";
  $("#slide-kicker").textContent = "YOUR OWN COLLECTION";
  $("#restore-samples").hidden = false;
  $("#upload-status").textContent = `已選取 ${files.length} 張圖片${selected.length > files.length ? `，略過 ${selected.length - files.length} 個不支援的檔案` : ""}。重新整理網頁後會返回範例圖片。`;
  buildDots();
  renderSlide();
  announceSlide();
  event.target.value = "";
});
$("#restore-samples").addEventListener("click", () => {
  deck.setSlides(SAMPLE_SLIDES);
  gestures.suppress(performance.now());
  handFlips.reset();
  handFlips.suppress(performance.now());
  fists.reset();
  fists.suppress(performance.now());
  twoHands.reset();
  twoHands.suppress(performance.now());
  $("#collection-label").textContent = "風景選集";
  $("#slide-kicker").textContent = "LANDSCAPE COLLECTION";
  $("#restore-samples").hidden = true;
  $("#upload-status").textContent = "已返回範例圖片。";
  buildDots();
  renderSlide();
  revokeLocalImages();
  announceSlide();
});

function stop(message = "已停止偵測，仍可使用按鈕瀏覽圖片。") {
  session += 1;
  running = false;
  cancelAnimationFrame(frameId);
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  gestures.reset();
  handFlips.reset();
  fists.reset();
  twoHands.reset();
  startButton.disabled = false;
  stopButton.disabled = true;
  $("#camera-placeholder").hidden = false;
  $("#tracking-dot").classList.remove("active");
  $("#pose").textContent = "等待手勢";
  badge.textContent = "攝影機未啟動";
  status.textContent = message;
}

function drawHands(hands) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#c0e0a0";
  ctx.fillStyle = "#ffdb97";
  ctx.lineWidth = 3;
  for (const points of hands) {
    for (const [a, b] of connections) {
      ctx.beginPath();
      ctx.moveTo(points[a].x * canvas.width, points[a].y * canvas.height);
      ctx.lineTo(points[b].x * canvas.width, points[b].y * canvas.height);
      ctx.stroke();
    }
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

function predict(now) {
  if (!running) return;
  try {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastInference >= 66) {
      lastVideoTime = video.currentTime;
      lastInference = now;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.parentElement.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
      }
      const result = recognizer.recognizeForVideo(video, now);
      drawHands(result.landmarks);
      const hands = result.landmarks.map((landmarks, index) => ({
        landmarks, worldLandmarks: result.worldLandmarks?.[index],
        id: result.handedness?.[index]?.[0]?.categoryName ?? "hand",
        gesture: result.gestures?.[index]?.[0],
      }));
      const flip = handFlips.update(hands, now);
      const fist = fists.update(flip.turning || flip.flip ? [] : hands, now);
      const transform = twoHands.update(flip.turning || flip.flip ? [] : hands, now,
        { ...deck.view, aspectRatio: video.videoWidth / video.videoHeight });
      // Keep the original single-hand navigation. Turning the palm takes priority.
      if (flip.turning || flip.flip || fist.closing || fist.flip) gestures.suppress(now);
      const singleHand = hands.length === 1;
      const command = gestures.update(singleHand && !flip.turning && !flip.flip && !fist.closing && !fist.flip ? hands[0] : null, now);
      $("#tracking-dot").classList.toggle("active", hands.length > 0);
      const poseText = flip.overlapping ? "請將雙手稍微分開，讓每隻手完整入鏡"
        : flip.turning ? "正在翻手，保持張開並讓另一面朝向鏡頭"
        : fist.pose === "fist" ? (fist.closing ? "握拳中，停留約半秒即可上下翻轉圖片" : "握拳已辨識；請先張開手掌，再握拳操作")
        : transform.active ? "雙手控制中：左右拉開放大，調整兩手高低來旋轉"
        : transform.acquiring ? "雙手保持張開，稍停後即可縮放與旋轉"
        : singleHand ? poseLabels[command.pose]
        : hands.length > 1 ? "雙手互動：翻轉任一隻張開的手掌，即可左右翻轉圖片" : "未偵測到手部，請將手放入畫面";
      if ($("#pose").textContent !== poseText) $("#pose").textContent = poseText;
      if (flip.flip) mirrorImage("gesture");
      else if (fist.flip) mirrorImage("gesture", "vertical");
      else if (transform.changed) {
        deck.setView(transform);
        renderView();
      }
      else if (command.action) navigate(command.action, "gesture");
    }
    frameId = requestAnimationFrame(predict);
  } catch (error) {
    console.error(error);
    stop("辨識中斷，請重新開啟攝影機；也可以使用按鈕瀏覽圖片。");
  }
}

function loadRecognizer() {
  if (!loadingPromise) {
    loadingPromise = (async () => {
      const { FilesetResolver, GestureRecognizer } = await import(`${CDN}/vision_bundle.mjs`);
      const vision = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      return GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
        runningMode: "VIDEO", numHands: 2,
        minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6,
      });
    })().catch((error) => { loadingPromise = undefined; throw error; });
  }
  return loadingPromise;
}

startButton.addEventListener("click", async () => {
  const token = ++session;
  startButton.disabled = true;
  stopButton.disabled = false;
  let acquiredStream;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("請使用 HTTPS 或 localhost，並確認瀏覽器支援攝影機。");
    }
    status.textContent = "正在載入手勢模型…你仍可使用右側按鈕瀏覽圖片。";
    recognizer = await loadRecognizer();
    if (token !== session) return;
    status.textContent = "請允許攝影機權限，或按停止取消。";
    acquiredStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false,
    });
    if (token !== session) {
      acquiredStream.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = acquiredStream;
    video.srcObject = stream;
    await video.play();
    if (token !== session) return;
    stream.getVideoTracks()[0].addEventListener("ended", () => {
      if (token === session) stop("攝影機連線已中斷，仍可使用按鈕瀏覽圖片。");
    }, { once: true });
    gestures.reset();
    handFlips.reset();
    fists.reset();
    twoHands.reset();
    running = true;
    lastVideoTime = -1;
    lastInference = -Infinity;
    $("#camera-placeholder").hidden = true;
    badge.textContent = "● 即時偵測中";
    status.textContent = "偵測中。單手換圖與握拳翻轉；雙手可放大、旋轉，手心／手背翻面可左右翻轉。";
    frameId = requestAnimationFrame(predict);
  } catch (error) {
    acquiredStream?.getTracks().forEach((track) => track.stop());
    if (token !== session) return;
    console.error(error);
    const messages = {
      NotAllowedError: "未取得攝影機權限，請在瀏覽器設定允許使用。",
      NotFoundError: "找不到攝影機，請確認裝置已連接。",
      NotReadableError: "無法開啟攝影機，請確認沒有被其他程式佔用。",
    };
    const detail = messages[error.name] || (error.message?.startsWith("請使用") ? error.message : "啟動失敗，請檢查網路、模型下載與瀏覽器支援後重試。");
    stop(`${detail} 你仍可使用按鈕瀏覽圖片。`);
  }
});

stopButton.addEventListener("click", () => stop());
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (running || startButton.disabled)) stop("頁面已暫停，返回後請重新開啟攝影機。");
});
window.addEventListener("pagehide", (event) => {
  stop();
  // Keep local object URLs and the model available when restored from bfcache.
  if (!event.persisted) {
    revokeLocalImages();
    loadingPromise?.then((model) => model.close()).catch(() => {});
    recognizer = undefined;
    loadingPromise = undefined;
  }
});

buildDots();
renderSlide();

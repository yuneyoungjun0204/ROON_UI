// 카메라 프레임 HTTP 업링크 — 3D 카메라 뷰를 JPEG로 캡처해 백엔드로 POST한다.
//
//   POST <httpApiBase>/devices/camera/<name>/frames
//   Authorization: Bearer <deviceToken>
//   Content-Type: image/jpeg
//   본문: JPEG 바이트
//
// 한 기기(토큰)로 여러 카메라를 이름으로 구분해 올린다(예: fpv, cctv).
// 이미지는 크고 무거워 MQTT에 부적합하므로 항상 HTTP다(명령은 MQTT).
//
// 라이브 스트리밍: 플랫폼이 스트림을 열면 MQTT로 {channel:"camera", value:<ms>, camera:<name>}
// 명령을 보낸다 → 해당 카메라 전송 주기를 fast(200ms)로 올린다. 시청자가 없으면 slow(10s)로
// 복귀 명령이 온다. 명령이 15초간 안 오면 스스로 slow로 되돌린다(백엔드 장애 안전망).

import * as THREE from "three";
import { config } from "../config";

const SELF_RECOVER_MS = 15000; // fast 명령이 이만큼 끊기면 slow로 자가 복귀

interface CamRuntime {
  intervalMs: number; // 현재 전송 주기
  lastFastAt: number; // 마지막 fast 명령 시각 (performance.now)
  lastSentAt: number; // 마지막 프레임 전송 시각
}

const runtime = new Map<string, CamRuntime>();

function stateFor(name: string): CamRuntime {
  let s = runtime.get(name);
  if (!s) {
    s = { intervalMs: config.cameraSlowIntervalMs, lastFastAt: 0, lastSentAt: 0 };
    runtime.set(name, s);
  }
  return s;
}

/** MQTT `camera` 명령 처리 — 특정 카메라의 전송 주기를 바꾼다.
 * name 미지정(레거시)이면 모든 카메라에 적용(브로드캐스트). */
export function setCameraInterval(name: string | undefined, intervalMs: number): void {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
  const now = performance.now();
  const apply = (s: CamRuntime) => {
    s.intervalMs = intervalMs;
    if (intervalMs < config.cameraSlowIntervalMs) s.lastFastAt = now; // fast일 때만 자가복귀 타이머 갱신
  };
  if (name) apply(stateFor(name));
  else runtime.forEach(apply);
}

// ── 오프스크린 캡처 자원 (지연 생성·재사용) ────────────────────────────────
let renderTarget: THREE.WebGLRenderTarget | null = null;
let readBuffer: Uint8Array | null = null;
let canvas2d: HTMLCanvasElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;

function ensureResources(): boolean {
  const w = config.cameraWidth;
  const h = config.cameraHeight;
  if (!renderTarget) {
    renderTarget = new THREE.WebGLRenderTarget(w, h);
    // sRGB로 인코딩해 읽어야 JPEG 색이 화면과 일치한다(선형이면 어둡게 나옴).
    renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
    readBuffer = new Uint8Array(w * h * 4);
  }
  if (!canvas2d) {
    canvas2d = document.createElement("canvas");
    canvas2d.width = w;
    canvas2d.height = h;
    ctx2d = canvas2d.getContext("2d");
  }
  return ctx2d != null && readBuffer != null && renderTarget != null;
}

/** 카메라 한 대를 오프스크린으로 렌더 → JPEG Blob으로 인코딩. 실패 시 null. */
function captureBlob(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): Promise<Blob | null> {
  if (!ensureResources()) return Promise.resolve(null);
  const rt = renderTarget!;
  const buf = readBuffer!;
  const ctx = ctx2d!;
  const w = rt.width;
  const h = rt.height;

  // 캡처용 종횡비로 임시 조정 후 원복
  const prevAspect = camera.aspect;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  renderer.setRenderTarget(prevTarget);

  camera.aspect = prevAspect;
  camera.updateProjectionMatrix();

  // GL은 아래→위 순서라 행을 뒤집어 2D 캔버스에 넣는다.
  const img = ctx.createImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * row;
    img.data.set(buf.subarray(src, src + row), y * row);
  }
  ctx.putImageData(img, 0, 0);

  return new Promise((resolve) =>
    canvas2d!.toBlob((b) => resolve(b), "image/jpeg", config.cameraQuality),
  );
}

async function postFrame(name: string, blob: Blob): Promise<void> {
  const url = `${config.httpApiBase.replace(/\/$/, "")}/devices/camera/${name}/frames`;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        Authorization: `Bearer ${config.deviceToken}`,
      },
      body: blob,
    });
  } catch {
    // 백엔드가 없거나 네트워크 오류 — 조용히 무시(다음 주기에 재시도)
  }
}

/** 프레임마다 호출 — 각 카메라를 주기에 맞춰 캡처·전송한다.
 * FpvRenderPass의 useFrame에서 메인/보조 렌더 뒤에 부른다(renderer/scene 접근 가능). */
export function tickCameraUplink(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  cameras: { name: string; cam: THREE.PerspectiveCamera }[],
  now: number,
): void {
  if (!config.cameraEnabled) return;
  for (const { name, cam } of cameras) {
    const s = stateFor(name);
    // 자가 복귀 — fast인데 명령이 끊긴 지 오래면 slow로
    if (s.intervalMs < config.cameraSlowIntervalMs && now - s.lastFastAt > SELF_RECOVER_MS) {
      s.intervalMs = config.cameraSlowIntervalMs;
    }
    if (now - s.lastSentAt < s.intervalMs) continue;
    s.lastSentAt = now;
    void captureBlob(renderer, scene, cam).then((blob) => {
      if (blob) void postFrame(name, blob);
    });
  }
}

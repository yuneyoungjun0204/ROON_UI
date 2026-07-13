// 환경 설정 — .env(.env.local)에서 읽는다. .env.example 참고.

const env = import.meta.env;

/** 브로커 접속 주소.
 * VITE_MQTT_URL이 있으면 그대로 쓰고,
 * 없으면 VITE_MQTT_PROTOCOL/HOST/PORT/PATH 조각으로 조립한다. */
function buildMqttUrl(): string {
  if (env.VITE_MQTT_URL) return env.VITE_MQTT_URL;
  const protocol = env.VITE_MQTT_PROTOCOL ?? "ws"; // ws | wss
  const host = env.VITE_MQTT_HOST ?? "localhost";
  const port = env.VITE_MQTT_PORT ?? (protocol === "wss" ? "8884" : "9001");
  const path = env.VITE_MQTT_PATH ?? "/"; // HiveMQ 등은 "/mqtt" 필요
  return `${protocol}://${host}:${port}${path}`;
}

/** 텔레메트리를 어디로 올릴지: "mqtt"(브로커) 또는 "http"(백엔드 직접 POST).
 * 명령(다운링크)은 항상 MQTT push다(HTTP는 업링크 전용) — 아래 enableMqttCommands 참고. */
function parseTransport(): "mqtt" | "http" {
  return env.VITE_TELEMETRY_TRANSPORT === "http" ? "http" : "mqtt";
}

export const config = {
  /** MQTT 브로커 WebSocket 주소 (Mosquitto websockets 리스너) */
  mqttUrl: buildMqttUrl(),
  mqttUsername: env.VITE_MQTT_USERNAME ?? "",
  mqttPassword: env.VITE_MQTT_PASSWORD ?? "",
  /** 텔레메트리 발행 경로 — "mqtt" | "http" */
  telemetryTransport: parseTransport(),
  /** HTTP 업링크 대상 백엔드 주소 (예: http://localhost:8000). transport=http일 때 사용 */
  httpApiBase: env.VITE_HTTP_API_BASE ?? "http://localhost:8000",
  /** MQTT로 명령을 수신할지 — false면 순수 HTTP 센서(브로커 접속 안 함) */
  enableMqttCommands: env.VITE_ENABLE_MQTT_COMMANDS !== "false",
  /** 텔레메트리 발행 토픽에 쓰는 기기 토큰: devices/<token>/telemetry */
  deviceToken: env.VITE_DEVICE_TOKEN ?? "sim-usv-1",
  /** 명령 구독 토픽에 쓰는 기기 ID: devices/<id>/commands */
  deviceId: env.VITE_DEVICE_ID ?? "1",
  /** VWorld 오픈 API 키 — 있으면 위성 지도/실제 지형, 없으면 절차적 바다 */
  vworldKey: env.VITE_VWORLD_KEY ?? "",
  /** 텔레메트리 발행 주기 (ms) */
  telemetryIntervalMs: Number(env.VITE_TELEMETRY_INTERVAL_MS ?? 2000),

  // ── 카메라 (HTTP 프레임 업링크) ──────────────────────────────
  // 한 기기(토큰)로 여러 카메라를 POST /devices/camera/<name>/frames 로 올린다.
  /** 카메라 프레임 전송 사용 여부 */
  cameraEnabled: env.VITE_CAMERA_ENABLED !== "false",
  /** 선수 1인칭(FPV) 카메라 이름 */
  cameraFpvName: env.VITE_CAMERA_FPV_NAME ?? "fpv",
  /** 스테이션 CCTV 카메라 이름 */
  cameraCctvName: env.VITE_CAMERA_CCTV_NAME ?? "cctv",
  /** 평상시(라이브 아님) 프레임 전송 주기 (ms) — 백엔드 SLOW_INTERVAL_MS와 일치 */
  cameraSlowIntervalMs: Number(env.VITE_CAMERA_SLOW_INTERVAL_MS ?? 10000),
  /** 전송 프레임 해상도·품질 */
  cameraWidth: Number(env.VITE_CAMERA_WIDTH ?? 640),
  cameraHeight: Number(env.VITE_CAMERA_HEIGHT ?? 360),
  cameraQuality: Number(env.VITE_CAMERA_QUALITY ?? 0.6),
  /** 시뮬레이션 시작 위치 (기본: 대청호 — 위성/지형 데이터 기준점) */
  initialLat: Number(env.VITE_INITIAL_LAT ?? 36.47655),
  initialLon: Number(env.VITE_INITIAL_LON ?? 127.48375),
};

/** 스테이션 존 반경 (m) — 시작 위치를 중심으로 한 기지 구역. 3D 원통·미니맵 원 공용. */
export const STATION_ZONE_RADIUS_M = 45;

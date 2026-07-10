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

export const config = {
  /** MQTT 브로커 WebSocket 주소 (Mosquitto websockets 리스너) */
  mqttUrl: buildMqttUrl(),
  mqttUsername: env.VITE_MQTT_USERNAME ?? "",
  mqttPassword: env.VITE_MQTT_PASSWORD ?? "",
  /** 텔레메트리 발행 토픽에 쓰는 기기 토큰: devices/<token>/telemetry */
  deviceToken: env.VITE_DEVICE_TOKEN ?? "sim-usv-1",
  /** 명령 구독 토픽에 쓰는 기기 ID: devices/<id>/commands */
  deviceId: env.VITE_DEVICE_ID ?? "1",
  /** 텔레메트리 발행 주기 (ms) */
  telemetryIntervalMs: Number(env.VITE_TELEMETRY_INTERVAL_MS ?? 2000),
  /** 시뮬레이션 시작 위치 (부산 앞바다) */
  initialLat: Number(env.VITE_INITIAL_LAT ?? 35.05),
  initialLon: Number(env.VITE_INITIAL_LON ?? 129.08),
};

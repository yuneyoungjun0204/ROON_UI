// 환경 설정 — .env(.env.local)에서 읽는다. .env.example 참고.
export const config = {
  /** MQTT 브로커 WebSocket 주소 (Mosquitto websockets 리스너) */
  mqttUrl: import.meta.env.VITE_MQTT_URL ?? "ws://localhost:9001",
  mqttUsername: import.meta.env.VITE_MQTT_USERNAME ?? "",
  mqttPassword: import.meta.env.VITE_MQTT_PASSWORD ?? "",
  /** 텔레메트리 발행 토픽에 쓰는 기기 토큰: devices/<token>/telemetry */
  deviceToken: import.meta.env.VITE_DEVICE_TOKEN ?? "sim-usv-1",
  /** 명령 구독 토픽에 쓰는 기기 ID: devices/<id>/commands */
  deviceId: import.meta.env.VITE_DEVICE_ID ?? "1",
  /** 텔레메트리 발행 주기 (ms) */
  telemetryIntervalMs: Number(import.meta.env.VITE_TELEMETRY_INTERVAL_MS ?? 2000),
  /** 시뮬레이션 시작 위치 (부산 앞바다) */
  initialLat: Number(import.meta.env.VITE_INITIAL_LAT ?? 35.05),
  initialLon: Number(import.meta.env.VITE_INITIAL_LON ?? 129.08),
};

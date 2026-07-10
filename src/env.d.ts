/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 전체 URL을 직접 지정 (지정 시 아래 조각 설정보다 우선) */
  readonly VITE_MQTT_URL?: string;
  /** ws | wss (기본 ws) */
  readonly VITE_MQTT_PROTOCOL?: string;
  /** 브로커 호스트 (기본 localhost) */
  readonly VITE_MQTT_HOST?: string;
  /** 브로커 WebSocket 포트 (기본 ws=9001, wss=8884) */
  readonly VITE_MQTT_PORT?: string;
  /** WebSocket 경로 (기본 "/", HiveMQ 등은 "/mqtt") */
  readonly VITE_MQTT_PATH?: string;
  readonly VITE_MQTT_USERNAME?: string;
  readonly VITE_MQTT_PASSWORD?: string;
  readonly VITE_DEVICE_TOKEN?: string;
  readonly VITE_DEVICE_ID?: string;
  readonly VITE_TELEMETRY_INTERVAL_MS?: string;
  readonly VITE_INITIAL_LAT?: string;
  readonly VITE_INITIAL_LON?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

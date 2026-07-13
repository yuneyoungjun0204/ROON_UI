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
  readonly VITE_VWORLD_KEY?: string;
  readonly VITE_TELEMETRY_INTERVAL_MS?: string;
  readonly VITE_INITIAL_LAT?: string;
  readonly VITE_INITIAL_LON?: string;
  /** 텔레메트리 경로 mqtt | http (기본 mqtt) */
  readonly VITE_TELEMETRY_TRANSPORT?: string;
  /** HTTP 업링크(텔레메트리·카메라) 대상 백엔드 (기본 http://localhost:8000) */
  readonly VITE_HTTP_API_BASE?: string;
  /** MQTT 명령 수신 여부 (기본 true) */
  readonly VITE_ENABLE_MQTT_COMMANDS?: string;
  /** 카메라 프레임 전송 사용 (기본 true) */
  readonly VITE_CAMERA_ENABLED?: string;
  /** 카메라 이름 — URL 경로로 카메라 구분 (기본 fpv / cctv) */
  readonly VITE_CAMERA_FPV_NAME?: string;
  readonly VITE_CAMERA_CCTV_NAME?: string;
  /** 평상시 프레임 전송 주기 ms (기본 10000) */
  readonly VITE_CAMERA_SLOW_INTERVAL_MS?: string;
  /** 전송 프레임 해상도·품질 (기본 640 / 360 / 0.6) */
  readonly VITE_CAMERA_WIDTH?: string;
  readonly VITE_CAMERA_HEIGHT?: string;
  readonly VITE_CAMERA_QUALITY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

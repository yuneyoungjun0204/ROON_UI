/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MQTT_URL?: string;
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

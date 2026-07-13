// ─────────────────────────────────────────────────────────────────────────
// 데이터 계약 (단일 출처) — iot-monitoring-control 플랫폼과 주고받는 값 정의.
//
//   • 텔레메트리 (시뮬레이터 → 플랫폼): { sensor, value, ts }  ← 값은 항상 숫자(float)
//   • 명령       (플랫폼 → 시뮬레이터): { channel, value }      ← 값은 JSON 스칼라(수/문자열)
//
// 이 파일이 "무엇을 보낼 수 있고 무엇을 받을 수 있는가"의 유일한 정의처다.
// MQTT(useMqtt)와 HTTP(useHttpTelemetry) 경로 모두 여기의 함수를 재사용한다.
// ─────────────────────────────────────────────────────────────────────────

import { config } from "./config";
import { useSimStore } from "./store";
import { lonLatToLocalMeters } from "./geo/webMercator";
import { setCameraInterval } from "./http/cameraUplink";

const MS_TO_KN = 1.943844;

/** 텔레메트리 측정값 한 건. 백엔드 스키마(`{sensor, value, ts}`)와 동일. */
export interface Reading {
  /** 측정 항목 이름 — 백엔드는 의미를 모르고 그대로 저장한다. */
  sensor: string;
  /** 측정값 — 항상 숫자. 불리언 상태는 0/1로 인코딩한다. */
  value: number;
  /** Unix epoch seconds. 생략 시 서버 수신 시각으로 해석된다. */
  ts: number;
}

// ── 텔레메트리 카탈로그 (문서/참고용) ──────────────────────────────────────
// 시뮬레이터가 발행하는 모든 센서의 목록·단위·설명. collectReadings()가 실제로
// 채우는 값과 1:1로 대응한다. UI나 문서 생성에 재사용할 수 있다.
export const TELEMETRY_CATALOG = [
  { sensor: "lat", unit: "deg", desc: "위도" },
  { sensor: "lon", unit: "deg", desc: "경도" },
  { sensor: "heading", unit: "deg", desc: "선수 방위각 (0–360)" },
  { sensor: "sog", unit: "kn", desc: "대지속력 (Speed Over Ground)" },
  { sensor: "speed_ms", unit: "m/s", desc: "속력 (미터/초)" },
  { sensor: "throttle", unit: "%", desc: "스로틀 지령 (-100–100)" },
  { sensor: "steer", unit: "%", desc: "조향 지령 (-100 좌 – 100 우)" },
  { sensor: "thrust_port", unit: "%", desc: "좌현 쓰러스터 실제 출력" },
  { sensor: "thrust_stbd", unit: "%", desc: "우현 쓰러스터 실제 출력" },
  { sensor: "battery", unit: "%", desc: "배터리 잔량" },
  { sensor: "charging", unit: "0/1", desc: "스테이션 충전 중" },
  { sensor: "autopilot", unit: "0/1", desc: "자동 항해 중" },
  { sensor: "mode", unit: "code", desc: "운항 모드 (0 수동·1 자율·2 복귀·3 표류)" },
  { sensor: "waypoints_total", unit: "count", desc: "총 웨이포인트 수" },
  { sensor: "waypoints_reached", unit: "count", desc: "도달한 웨이포인트 수" },
  { sensor: "dist_to_station", unit: "m", desc: "스테이션(기지)까지 직선거리" },
] as const;

/** 운항 모드 코드 — value는 숫자만 가능하므로 문자열 대신 정수로 인코딩한다.
 * 플랫폼 콘솔에서 이 코드를 라벨로 되돌려 표시하면 된다. */
export const MODE = {
  manual: 0, // 수동 조작
  auto: 1, // 자율 운항 (웨이포인트 추종)
  homing: 2, // 스테이션 복귀 중
  drift: 3, // 배터리 방전 표류 (추진 불가)
} as const;

/** 현재 상태에서 운항 모드 코드를 도출한다. */
function currentModeCode(
  battery: number,
  autopilot: boolean,
  returning: boolean,
): number {
  if (battery <= 0) return MODE.drift;
  if (returning) return MODE.homing;
  if (autopilot) return MODE.auto;
  return MODE.manual;
}

/** 현재 시뮬레이션 상태에서 텔레메트리 측정값 배열을 만든다.
 * 발행 경로(MQTT/HTTP)와 무관하게 "무엇을 보낼지"는 여기 한 곳에서 결정된다. */
export function collectReadings(): Reading[] {
  const { usv, battery, charging, autopilot, returningToStation, waypoints, reachedCount } =
    useSimStore.getState();
  const ts = Math.floor(Date.now() / 1000);
  const distToStation = Math.hypot(usv.x, usv.z);

  const values: Record<string, number> = {
    lat: usv.lat,
    lon: usv.lon,
    heading: usv.heading,
    sog: usv.speed * MS_TO_KN,
    speed_ms: usv.speed,
    throttle: usv.throttle,
    steer: usv.steer,
    thrust_port: usv.thrustPort,
    thrust_stbd: usv.thrustStbd,
    battery,
    charging: charging ? 1 : 0,
    autopilot: autopilot ? 1 : 0,
    mode: currentModeCode(battery, autopilot, returningToStation),
    waypoints_total: waypoints.length,
    waypoints_reached: reachedCount,
    dist_to_station: distToStation,
  };

  return Object.entries(values).map(([sensor, value]) => ({
    sensor,
    value: Number(value.toFixed(6)),
    ts,
  }));
}

// ── 명령 카탈로그 (문서/참고용) ────────────────────────────────────────────
// 플랫폼에서 devices/<id>/commands 로 보낼 수 있는 채널 목록. value 타입/범위는
// 펌웨어(=이 시뮬레이터)가 정의한다 — 백엔드는 그대로 전달만 한다.
export const COMMAND_CATALOG = [
  { channel: "waypoints", value: '"lat,lon;lat,lon;..."', desc: "경로 전체 교체 (세미콜론 구분)" },
  { channel: "stop", value: "(무시)", desc: "정지 — 추력 차단·자동항해 취소" },
  { channel: "homing", value: "(무시)", desc: "스테이션으로 자동 복귀" },
  { channel: "steer", value: "% (-100–100)", desc: "조향 지령 (음수=좌, 양수=우)" },
  { channel: "throttle", value: "% (-100–100)", desc: "스로틀 지령 (음수=후진)" },
  { channel: "autopilot", value: "0 | 1", desc: "자동 항해 켜기/끄기" },
  { channel: "waypoint", value: '"lat,lon"', desc: "웨이포인트 하나 추가 (누적)" },
  { channel: "battery", value: "% (0–100)", desc: "배터리 잔량 직접 설정 (디버그)" },
  { channel: "reset", value: "(무시)", desc: "시뮬레이션 전체 초기화" },
  { channel: "camera", value: "ms (+camera 이름)", desc: "라이브 fast/slow — 카메라 전송 주기 (플랫폼이 자동 발행)" },
  // 레거시/별칭: rudder(→steer 환산), estop(=stop), return_station(=homing), clear_waypoints
] as const;

/** "lat,lon" 문자열을 씬 로컬 좌표(ENU 미터)로 변환. 형식이 틀리면 null. */
function parseLatLon(pair: string) {
  const parts = pair.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  const [lat, lon] = parts;
  return lonLatToLocalMeters(lon, lat, config.initialLon, config.initialLat);
}

/** 수신한 명령 하나를 시뮬레이션에 반영한다.
 * 처리했으면 HUD에 표시할 설명 문자열을, 알 수 없는 채널이면 null을 반환한다.
 * extra는 {channel, value} 외의 추가 필드(예: camera 라이브 명령의 camera 이름). */
export function applyCommand(
  channel: string,
  rawValue: unknown,
  extra?: Record<string, unknown>,
): string | null {
  const store = useSimStore.getState();
  const num = Number(rawValue);
  const hasNum = Number.isFinite(num);

  switch (channel) {
    case "camera": {
      // 라이브 스트리밍 fast/slow 전환 — 특정 카메라의 전송 주기(ms)를 바꾼다.
      if (!hasNum) return null;
      const name = typeof extra?.camera === "string" ? extra.camera : undefined;
      setCameraInterval(name, num);
      return `camera ${name ?? "*"} → ${num}ms`;
    }

    case "steer":
      if (!hasNum) return null;
      store.setSteer(num);
      return `steer → ${num}%`;

    case "throttle":
      if (!hasNum) return null;
      store.setThrottle(num);
      return `throttle → ${num}%`;

    case "rudder": // 구버전 호환: 타각(deg, ±35) → 조향(%, ±100)으로 환산
      if (!hasNum) return null;
      store.setSteer((num / 35) * 100);
      return `rudder → ${num}°`;

    case "autopilot":
      store.setAutopilot(num >= 0.5);
      return `autopilot → ${num >= 0.5 ? "ON" : "OFF"}`;

    case "battery":
      if (!hasNum) return null;
      store.setBattery(num);
      return `battery → ${num}%`;

    case "waypoints": {
      // 경로 전체 교체: value = "lat,lon;lat,lon;..." — 기존 경로를 지우고 새로 세팅.
      const pairs = String(rawValue).split(";").map((s) => s.trim()).filter(Boolean);
      const points = pairs.map((pair) => parseLatLon(pair));
      if (points.some((p) => p == null)) return null; // 하나라도 형식 오류면 전체 무시
      store.clearWaypoints();
      for (const p of points) store.addWaypoint(p!);
      return `waypoints → ${points.length}개 경로 설정`;
    }

    case "waypoint": {
      // value: "lat,lon" 하나 — 기존 경로 뒤에 누적 추가.
      const p = parseLatLon(String(rawValue));
      if (!p) return null;
      store.addWaypoint(p);
      return `waypoint → ${String(rawValue).trim()}`;
    }

    case "clear_waypoints":
      store.clearWaypoints();
      return "웨이포인트 삭제 (원격)";

    case "homing": // 별칭: return_station
    case "return_station":
      store.returnToStation();
      return "스테이션 복귀 (원격)";

    case "stop": // 별칭: estop
    case "estop":
      store.emergencyStop();
      return "정지 (원격)";

    case "reset":
      store.resetSimulation();
      return "시뮬레이션 초기화 (원격)";

    default:
      return null; // 알 수 없는 채널 — 무시
  }
}

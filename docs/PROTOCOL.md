# 데이터 프로토콜 — 시뮬레이터 ↔ 관제 플랫폼

USV 시뮬레이터가 [iot-monitoring-control](https://github.com/als8921/iot-monitoring-control) 플랫폼과 **MQTT 또는 HTTP**로 주고받는 값의 정의입니다.
계약의 단일 출처는 코드의 [`src/protocol.ts`](../src/protocol.ts)이며, 이 문서는 그 요약입니다.

## 방향과 경로

| 방향 | 이름 | MQTT | HTTP |
| --- | --- | --- | --- |
| 시뮬레이터 → 플랫폼 | **텔레메트리** (업링크) | `devices/<token>/telemetry` 발행 | `POST /devices/telemetry` |
| 플랫폼 → 시뮬레이터 | **명령** (다운링크) | `devices/<id>/commands` 구독 | ❌ (MQTT 전용) |
| 시뮬레이터 → 플랫폼 | **카메라** (프레임) | ❌ (HTTP 전용) | `POST /devices/camera/<name>/frames` |

> 설계 원칙: **올라가기만 하는 값(텔레메트리)**은 HTTP도 되지만, **내려와야 하는 값(명령)**은 브로커가 NAT 뒤 기기로 push해야 하므로 MQTT만 가능합니다. `VITE_TELEMETRY_TRANSPORT`로 텔레메트리 경로를 고릅니다.

---

## 1. 텔레메트리 (시뮬레이터 → 플랫폼)

측정값 한 건의 형식은 백엔드 스키마와 동일합니다. **값은 항상 숫자(float)**, 불리언 상태는 `0`/`1`로 인코딩합니다.

```json
{ "sensor": "sog", "value": 12.34, "ts": 1719560000 }
```

- `ts` — Unix epoch seconds. 생략 시 서버 수신 시각으로 해석.
- **MQTT**: 측정값을 **항목별로 쪼개 단건**으로 발행 (워커가 단건만 받음).
- **HTTP**: 한 요청에 **배열(배치)**로 전송. `POST /devices/telemetry`, 헤더 `Authorization: Bearer <token>`, 본문:

```json
[
  { "sensor": "lat", "value": 36.47655, "ts": 1719560000 },
  { "sensor": "lon", "value": 127.48375, "ts": 1719560000 }
]
```

### 보내는 센서 목록

| sensor | 단위 | 설명 |
| --- | --- | --- |
| `lat` | deg | 위도 |
| `lon` | deg | 경도 |
| `heading` | deg | 선수 방위각 (0–360) |
| `sog` | kn | 대지속력 (Speed Over Ground) |
| `speed_ms` | m/s | 속력 (미터/초) |
| `throttle` | % | 스로틀 지령 (-100–100) |
| `steer` | % | 조향 지령 (-100 좌 – 100 우) |
| `thrust_port` | % | 좌현 쓰러스터 실제 출력 |
| `thrust_stbd` | % | 우현 쓰러스터 실제 출력 |
| `battery` | % | 배터리 잔량 |
| `charging` | 0/1 | 스테이션 충전 중 |
| `autopilot` | 0/1 | 자동 항해 중 |
| `mode` | code | 운항 모드 — `0` 수동 · `1` 자율 · `2` 복귀 · `3` 표류 |
| `waypoints_total` | count | 총 웨이포인트 수 |
| `waypoints_reached` | count | 도달한 웨이포인트 수 |
| `dist_to_station` | m | 스테이션(기지)까지 직선거리 |

---

## 2. 명령 (플랫폼 → 시뮬레이터)

토픽 `devices/<id>/commands`, QoS 1, 비-retained. 값은 JSON 스칼라(수/문자열)이고 **의미·범위는 기기(시뮬레이터)가 정의**합니다.

```json
{ "channel": "waypoints", "value": "36.4780,127.4850;36.4790,127.4860" }
{ "channel": "stop",   "value": 1 }
{ "channel": "homing", "value": 1 }
```

### 받는 채널 목록

| channel | value | 동작 |
| --- | --- | --- |
| `waypoints` | `"lat,lon;lat,lon;..."` | **경로 전체 교체** (세미콜론 구분). 기존 경로를 지우고 새로 설정 |
| `stop` | (무시) | 정지 — 추력 차단·자동항해 취소 |
| `homing` | (무시) | 스테이션으로 자동 복귀 |
| `steer` | % (-100–100) | 조향 지령 (음수=좌, 양수=우) |
| `throttle` | % (-100–100) | 스로틀 지령 (음수=후진) |
| `autopilot` | `0` \| `1` | 자동 항해 켜기/끄기 |
| `waypoint` | `"lat,lon"` | 웨이포인트 하나 추가 (누적) |
| `battery` | % (0–100) | 배터리 잔량 직접 설정 (디버그) |
| `reset` | (무시) | 시뮬레이션 전체 초기화 |

> 별칭: `estop`(=`stop`) · `return_station`(=`homing`) · `rudder`(deg → `steer`% 환산) · `clear_waypoints`. 알 수 없는 채널은 조용히 무시됩니다.

---

## 3. 설정

`.env.local` (견본: `.env.example`)에서 경로와 대상을 고릅니다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `VITE_TELEMETRY_TRANSPORT` | `mqtt` | 텔레메트리 경로 — `mqtt` \| `http` |
| `VITE_HTTP_API_BASE` | `http://localhost:8000` | HTTP 업링크 대상 백엔드 |
| `VITE_ENABLE_MQTT_COMMANDS` | `true` | MQTT 명령 수신 여부 (`false`면 순수 HTTP 센서) |
| `VITE_DEVICE_TOKEN` | `sim-usv-1` | 텔레메트리 토픽/HTTP 인증의 기기 토큰 |
| `VITE_DEVICE_ID` | `1` | 명령 구독 토픽의 기기 ID |
| `VITE_TELEMETRY_INTERVAL_MS` | `2000` | 발행 주기 (ms) |

### 조합 예시

- **MQTT 양방향** (기본·현재 구성): `TRANSPORT=mqtt` → 텔레메트리 발행 + 명령 수신.
- **HTTP 업링크 + MQTT 명령**: `TRANSPORT=http`, `ENABLE_MQTT_COMMANDS=true` → HTTP로 올리고 명령은 브로커로 받음.

---

## 4. 카메라 (시뮬레이터 → 플랫폼)

카메라 영상은 **세 번째 통로**입니다. 이미지 바이트는 크고 무거워 MQTT(브로커가 영상 중계기가
되고 head-of-line 지연 발생)에 부적합하므로 **HTTP 전용**입니다.

- 엔드포인트: `POST /devices/camera/<name>/frames`
  - 헤더: `Content-Type: image/jpeg`, `Authorization: Bearer <token>`
  - 본문: JPEG 바이트
- **한 토큰(기기)으로 여러 카메라**를 이름(`^[A-Za-z0-9_-]{1,64}$`)으로 구분해 올립니다.
  이름 없는 `POST /devices/camera/frames`는 `default` 카메라로 적립됩니다(1카메라 하위호환).

### 보내는 카메라

시뮬레이터의 3D 뷰(`FpvCamera`)를 오프스크린으로 JPEG 캡처해 전송합니다.

| 이름 | 소스 | 뷰 |
| --- | --- | --- |
| `fpv` | `fpvCamera` | 선수 1인칭 (쌍동선 데크 앞, 침로·파도 자세 반영) |
| `cctv` | `cctvCamera` | 스테이션 존 상공 고정 감시 |

### 라이브 스트리밍 (fast/slow)

평상시엔 `cameraSlowIntervalMs`(기본 10초)로 대역폭을 아끼고, 플랫폼에서 라이브 스트림을 열면
백엔드가 **MQTT 명령**으로 해당 카메라 전송 주기를 fast로 올립니다:

```json
{ "channel": "camera", "value": 200, "camera": "fpv" }   // fast (200ms)
{ "channel": "camera", "value": 10000, "camera": "fpv" } // slow 복귀
```

- `value` = 프레임 간격(ms), `camera` = 대상 카메라 이름.
- 명령이 **15초간 끊기면** 스스로 slow로 복귀합니다(백엔드/네트워크 장애 안전망).

> 텔레메트리·명령은 MQTT, **카메라만 HTTP**. 세 통로 모두 같은 기기 토큰을 씁니다.
- **순수 HTTP 센서**: `TRANSPORT=http`, `ENABLE_MQTT_COMMANDS=false` → 브로커 접속 없음, 업링크 전용.

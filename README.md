# USV Simulator

무인수상정(USV)을 브라우저에서 3D로 시뮬레이션하고, MQTT로 [iot-monitoring-control](https://github.com/als8921/iot-monitoring-control) 관제 플랫폼과 연동하는 웹 시뮬레이터입니다.

- **3D 씬**: Three.js + React Three Fiber — 위성 지도·실제 지형(대청호), Gerstner 파도 수면, PBR 조명, 추적 카메라
- **시뮬레이션**: 타각/스로틀 → 선회율/가감속 → 침로·속력·위경도 적분 (운동학 모델, 60Hz, 3-tau 관성)
- **관제 연동 (MQTT / HTTP)**: 텔레메트리를 브로커(MQTT over WebSocket) 또는 백엔드(HTTP POST)로 전송
  - 텔레메트리 발행 — 위경도·침로·속력·추력·배터리·운항모드 등 16종 (`{sensor, value, ts}`)
  - 명령 수신 `devices/<id>/commands` — `waypoints`(경로 교체)·`stop`·`homing`·조향·스로틀 등 (`{channel, value}`)
  - 카메라 프레임 — `fpv`·`cctv` 2대를 한 토큰으로 HTTP 전송 (`POST /devices/camera/<name>/frames`), 라이브 스트리밍 연동
  - **주고받는 값 전체 정의**: [`docs/PROTOCOL.md`](./docs/PROTOCOL.md)

```
USV Simulator(브라우저) ══ ws://9001 ══╗
                                       ▼
                                   Mosquitto ── tcp://1883 ── 백엔드 워커 → DB → 관제 콘솔
```

## 빠른 시작

```bash
npm install
cp .env.example .env.local     # 선택: 키·브로커 설정 (안 해도 실행됨)
npm run dev                     # http://localhost:5173
```

키를 하나도 안 넣어도 **절차적 바다**로 바로 실행됩니다. 위성 지도·실제 지형(대청호)과 MQTT 연동을 쓰려면 아래 키를 채우세요.

## 필요한 키 (선택)

`.env.local` 파일에 원하는 것만 한 줄씩 채우면 됩니다.

### 1. VWorld 키 — 위성 지도 / 실제 지형

없으면 절차적 바다, 있으면 위성 지도 + 실제 지형(대청호)으로 실행됩니다.

1. [www.vworld.kr](https://www.vworld.kr) 로그인 → **오픈API > 인증키 발급**
2. 서비스 유형 **웹사이트**, 도메인에 `http://localhost:5173` (배포 시 배포 도메인) 등록
3. 발급받은 키를 `.env.local`에 붙여넣기:

```bash
VITE_VWORLD_KEY=발급받은-키
```

### 2. MQTT 브로커 — 관제 플랫폼 연동

브로커가 없어도 시뮬레이터는 동작합니다(HUD에 "연결 끊김"). 로컬 연동은 iot-monitoring-control의 Mosquitto에 **WebSocket 리스너(9001)**가 켜져 있어야 합니다.

```bash
VITE_MQTT_HOST=localhost        # 브로커 호스트
VITE_MQTT_USERNAME=device
VITE_MQTT_PASSWORD=발급받은-비밀번호
```

### 환경변수 전체

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `VITE_VWORLD_KEY` | — | VWorld 인증키 (위성 지도/지형). 없으면 절차적 바다 |
| `VITE_TELEMETRY_TRANSPORT` | `mqtt` | 텔레메트리 경로 — `mqtt` 또는 `http` |
| `VITE_HTTP_API_BASE` | `http://localhost:8000` | HTTP 업링크 대상 백엔드 (`transport=http`) |
| `VITE_ENABLE_MQTT_COMMANDS` | `true` | MQTT 명령 수신 (`false`면 순수 HTTP 센서) |
| `VITE_MQTT_PROTOCOL` | `ws` | `ws` 또는 `wss` |
| `VITE_MQTT_HOST` | `localhost` | 브로커 호스트 |
| `VITE_MQTT_PORT` | ws=`9001`, wss=`8884` | WebSocket 포트 |
| `VITE_MQTT_PATH` | `/` | WebSocket 경로 (HiveMQ 등은 `/mqtt`) |
| `VITE_MQTT_URL` | — | 전체 URL 직접 지정 (설정 시 위 조각들보다 우선) |
| `VITE_MQTT_USERNAME` / `VITE_MQTT_PASSWORD` | — | 브로커 계정 |
| `VITE_DEVICE_TOKEN` | `sim-usv-1` | 텔레메트리 발행 토픽의 기기 토큰 |
| `VITE_DEVICE_ID` | `1` | 명령 구독 토픽의 기기 ID |
| `VITE_TELEMETRY_INTERVAL_MS` | `2000` | 텔레메트리 발행 주기 (ms) |
| `VITE_INITIAL_LAT` / `VITE_INITIAL_LON` | `36.47655` / `127.48375` | 시작 위치 (기본: 대청호) |

> `.env.local`은 `.gitignore`에 포함되어 커밋되지 않습니다 — 키를 안심하고 넣으세요.

## 조작

| 입력 | 동작 |
| --- | --- |
| **↑ / ↓** (또는 W/S) | 스로틀 증가 / 감소 (떼면 그 값 유지) |
| **← / →** (또는 A/D) | 좌현 / 우현 타각 (떼면 타 자동 중앙 복원) |
| **Space** | 타 즉시 중앙 |
| **마우스 드래그 / 휠** | 카메라 회전 / 줌 |

하단 슬라이더로도 조작할 수 있고, 관제 플랫폼에서 명령(`waypoints`·`stop`·`homing`·`steer`·`throttle` 등)을 보내면 원격 제어됩니다. 전체 채널은 [`docs/PROTOCOL.md`](./docs/PROTOCOL.md) 참고.

## 명령어

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 (http://localhost:5173) |
| `npm run build` | 프로덕션 빌드 (타입체크 포함) |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run lint` | 정적 분석 (oxlint) |

### 서버 시작/중지

```bash
# 시작
cd /home/yune/민철_UI/usv-simulator && npm run dev

# 중지 (실행 중인 터미널에서)
Ctrl + C

# 중지 (다른 터미널에서)
pkill -f vite
```

배포 전 검증: `npm run lint && npm run build`

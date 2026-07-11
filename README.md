# USV Simulator

무인수상정(USV)을 3D로 시뮬레이션하고, MQTT로 [iot-monitoring-control](https://github.com/als8921/iot-monitoring-control) 플랫폼과 연동하는 웹 시뮬레이터입니다.

- **3D 씬**: Three.js + React Three Fiber — 절차적 파도 바다, 로우폴리 USV, 추적 카메라
- **시뮬레이션**: 타각/스로틀 → 선회율/가감속 → 침로·속력·위경도 적분 (운동학 모델, 60Hz, 최고 20kn·3-tau 관성)
- **MQTT 연동**: 브라우저에서 MQTT over WebSocket으로 브로커에 직접 접속
  - 발행: `devices/<token>/telemetry` — `{sensor, value, ts}` 형식으로 lat / lon / heading / sog / rudder
  - 구독: `devices/<id>/commands` — `{channel: "rudder"|"throttle", value}` 명령을 수신해 시뮬레이션에 반영

```
USV Simulator(브라우저) ══ ws://9001 ══╗
                                       ▼
                                   Mosquitto ── tcp://1883 ── 백엔드 워커 → DB → 관제 콘솔
```

## 실행

```bash
npm install
cp .env.example .env.local   # 브로커 주소·기기 토큰 설정
npm run dev
```

브로커 없이도 실행됩니다(HUD에 "연결 끊김" 표시). 로컬 연동을 하려면 iot-monitoring-control의 Mosquitto에 WebSocket 리스너(9001)가 켜져 있어야 합니다.

### 환경변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `VITE_MQTT_PROTOCOL` | `ws` | `ws` 또는 `wss` |
| `VITE_MQTT_HOST` | `localhost` | 브로커 호스트 |
| `VITE_MQTT_PORT` | ws=`9001`, wss=`8884` | WebSocket 포트 |
| `VITE_MQTT_PATH` | `/` | WebSocket 경로 (HiveMQ 등은 `/mqtt`) |
| `VITE_MQTT_URL` | — | 전체 URL 직접 지정 (설정 시 위 조각들보다 우선) |
| `VITE_MQTT_USERNAME` / `VITE_MQTT_PASSWORD` | — | 브로커 계정 (로컬 브로커는 `device` 계정) |
| `VITE_DEVICE_TOKEN` | `sim-usv-1` | 텔레메트리 발행 토픽의 기기 토큰 |
| `VITE_DEVICE_ID` | `1` | 명령 구독 토픽의 기기 ID |
| `VITE_TELEMETRY_INTERVAL_MS` | `2000` | 텔레메트리 발행 주기 |
| `VITE_INITIAL_LAT` / `VITE_INITIAL_LON` | `35.05` / `129.08` | 시작 위치 |

## 조작

| 입력 | 동작 |
| --- | --- |
| ← / → (또는 A/D) | 누르는 동안 타각 증가, 떼면 타 중앙 자동 복원 |
| ↑ / ↓ (또는 W/S) | 누르는 동안 스로틀 증감 (떼면 유지) |
| Space | 타 즉시 중앙 |
| 마우스 드래그 / 휠 | 카메라 회전 / 줌 |

하단 패널의 슬라이더로도 조작할 수 있고, 관제 플랫폼에서 `rudder` / `throttle` 채널 명령을 보내면 원격 제어됩니다.

## 검증

```bash
npm run lint && npm run build
```

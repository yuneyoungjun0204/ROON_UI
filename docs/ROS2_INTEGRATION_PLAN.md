# USV 시뮬레이터 ↔ ROS2 통합 계획

## 1. 현재 아키텍처 분석

### 1.1 USV 시뮬레이터 (Web)
```
┌─────────────────────────────────────────────────────────────┐
│                    USV Simulator (Browser)                   │
│  ┌──────────────┐    ┌───────────────┐    ┌──────────────┐  │
│  │  store.ts    │ → │ protocol.ts   │ → │    MQTT      │  │
│  │ (Zustand)    │    │ (텔레메트리)   │    │ (WebSocket)  │  │
│  └──────────────┘    └───────────────┘    └──────────────┘  │
│                                                              │
│  센서 출력: lat, lon, heading, speed, battery, autopilot...  │
│  명령 수신: throttle, steer, waypoints, autopilot, stop...   │
└─────────────────────────────────────────────────────────────┘
                           ↕ MQTT (ws://localhost:9001)
```

### 1.2 oneway_ros2 (ROS2 RL 추론)
```
┌─────────────────────────────────────────────────────────────┐
│                    oneway_ros2 (ROS2)                        │
│  ┌──────────────┐    ┌───────────────┐    ┌──────────────┐  │
│  │ world_state  │ ← │ bridge_node   │ ← │  GPS/IMU     │  │
│  │ (상태 캐시)   │    │ (RL 추론)     │    │ (NavSatFix)  │  │
│  └──────────────┘    └───────────────┘    └──────────────┘  │
│                                                              │
│  구독: /ally_{i}/fix, /ally_{i}/imu, /enemy_{i}/fix          │
│  발행: /ally_{i}/waypoints (nav_msgs/Path)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 통합 아키텍처

### 2.1 Phase 1: MQTT ↔ ROS2 브릿지 (즉시 구현)
```
┌─────────────┐     MQTT      ┌─────────────┐     ROS2      ┌─────────────┐
│   USV Web   │ ←──────────→ │ mqtt_bridge │ ←──────────→ │ oneway_ros2 │
│  Simulator  │  ws://9001   │   (Python)  │   DDS Topics  │  RL Engine  │
└─────────────┘              └─────────────┘               └─────────────┘
```

### 2.2 Phase 2: 다중 선박 지원
```
┌─────────────┐              ┌─────────────┐               ┌─────────────┐
│   USV Web   │              │             │               │             │
│ (3 Allies)  │  ←─ MQTT ──→ │ mqtt_bridge │ ←── ROS2 ──→ │ oneway_ros2 │
│ (10 Enemies)│              │ (다중 토픽)  │               │ (RL 추론)   │
└─────────────┘              └─────────────┘               └─────────────┘
```

### 2.3 Phase 3: 실제 선박 센서 연동
```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ 실제 GPS    │ ──→ │              │     │             │
│ 실제 IMU    │ ──→ │   ROS2 Node  │ ──→ │ mqtt_bridge │ ──→ USV Web
│ 실제 AIS    │ ──→ │  (센서 수집)  │     │             │     (시각화)
└─────────────┘     └──────────────┘     └─────────────┘
```

---

## 3. 데이터 매핑

### 3.1 USV Simulator → ROS2

| USV Simulator (MQTT) | ROS2 Topic | Message Type |
|---------------------|------------|--------------|
| `lat`, `lon` | `/ally_{i}/fix` | `sensor_msgs/NavSatFix` |
| `heading` | `/ally_{i}/imu` | `sensor_msgs/Imu` (quaternion) |
| `speed_ms` | `/ally_{i}/velocity` | `geometry_msgs/TwistStamped` |
| `battery` | `/ally_{i}/battery` | `sensor_msgs/BatteryState` |
| `autopilot` | `/ally_{i}/mode` | `std_msgs/UInt8` |

### 3.2 ROS2 → USV Simulator

| ROS2 Topic | USV Simulator (MQTT) | Command |
|------------|---------------------|---------|
| `/ally_{i}/waypoints` | `waypoints` | "lat,lon;lat,lon;..." |
| `/ally_{i}/cmd_vel` | `throttle`, `steer` | 속도/조향 제어 |
| `/ally_{i}/stop` | `stop` | 비상정지 |

### 3.3 좌표계 변환

```
USV Simulator                    ROS2 oneway
─────────────                    ───────────
heading: 0°=North, CW+    ←→    yaw_enu: 0°=East, CCW+
                                (변환: yaw_enu = 90 - heading)

lat, lon (WGS84)          ←→    lat, lon (WGS84)
                                (동일, 변환 불필요)

SIM 좌표: [0, 12600]²     ←→    geo_bridge로 변환
```

---

## 4. 구현 계획

### Phase 1: MQTT-ROS2 브릿지 (1주)
- [x] 아키텍처 설계
- [ ] `mqtt_ros2_bridge` ROS2 패키지 생성
- [ ] MQTT → ROS2 변환 노드 구현
- [ ] ROS2 → MQTT 변환 노드 구현
- [ ] 테스트: USV Sim ↔ oneway_ros2

### Phase 2: 다중 선박 확장 (1주)
- [ ] 다중 선박 MQTT 토픽 구조 설계
- [ ] 방어 시뮬레이터 연동
- [ ] 3 아군 + 10 적군 데이터 브릿지

### Phase 3: 실제 센서 통합 (2주)
- [ ] GPS 수신기 ROS2 드라이버
- [ ] IMU 센서 ROS2 드라이버
- [ ] AIS 수신기 통합 (적군 탐지)
- [ ] 센서 퓨전 노드

---

## 5. MQTT 토픽 구조 (확장)

### 5.1 단일 선박 모드 (기존)
```
devices/{device_token}/telemetry    # 텔레메트리 발행
devices/{device_id}/commands        # 명령 수신
```

### 5.2 다중 선박 모드 (신규)
```
# 아군 (Allies)
usv/ally/{id}/telemetry             # 개별 아군 텔레메트리
usv/ally/{id}/commands              # 개별 아군 명령
usv/ally/all/telemetry              # 전체 아군 일괄 (효율성)

# 적군 (Enemies)
usv/enemy/{id}/telemetry            # 개별 적군 위치
usv/enemy/all/telemetry             # 전체 적군 일괄

# 모선 (Mothership)
usv/mothership/telemetry            # 모선 상태

# 시스템
usv/system/status                   # 시뮬레이션 상태
usv/system/config                   # 설정 변경
```

---

## 6. 파일 구조

```
/home/yune/ros2_ws/src/
├── oneway_ros2/                    # 기존 RL 추론
├── mqtt_ros2_bridge/               # 신규 브릿지 패키지
│   ├── mqtt_ros2_bridge/
│   │   ├── __init__.py
│   │   ├── bridge_node.py          # 메인 브릿지
│   │   ├── mqtt_client.py          # MQTT 연결
│   │   ├── converters.py           # 메시지 변환
│   │   └── config.py               # 설정
│   ├── config/
│   │   └── bridge_params.yaml
│   ├── launch/
│   │   └── bridge.launch.py
│   ├── package.xml
│   └── setup.py
└── usv_msgs/                       # 커스텀 메시지 (선택)
    ├── msg/
    │   ├── UsvTelemetry.msg
    │   └── UsvCommand.msg
    └── package.xml
```

---

## 7. 실행 순서

### 개발/테스트
```bash
# 1. USV 시뮬레이터 시작
cd /home/yune/민철_UI/usv-simulator
npm run dev

# 2. MQTT 브로커 시작 (Mosquitto)
mosquitto -c /etc/mosquitto/mosquitto.conf

# 3. MQTT-ROS2 브릿지 시작
ros2 launch mqtt_ros2_bridge bridge.launch.py

# 4. oneway_ros2 시작
ros2 launch oneway_ros2 oneway.launch.py
```

### 실제 선박 연동
```bash
# 1. 센서 드라이버 시작
ros2 launch usv_sensors sensors.launch.py

# 2. MQTT 브릿지 (센서 → 웹)
ros2 launch mqtt_ros2_bridge sensor_bridge.launch.py

# 3. 웹 UI에서 실시간 모니터링
# http://localhost:5173/?mode=defense
```

---

## 8. 환경 변수 (.env)

```env
# MQTT 브로커
VITE_MQTT_URL=ws://localhost:9001
VITE_DEVICE_TOKEN=sim-usv-1
VITE_DEVICE_ID=1

# 다중 선박 모드
VITE_MULTI_VESSEL_MODE=true
VITE_N_ALLIES=3
VITE_N_ENEMIES=10

# ROS2 브릿지
ROS2_BRIDGE_MQTT_HOST=localhost
ROS2_BRIDGE_MQTT_PORT=9001
ROS2_BRIDGE_RATE=10.0
```

---

## 9. 다음 단계

1. **즉시 구현**: `mqtt_ros2_bridge` 패키지 생성
2. **테스트**: USV Simulator ↔ oneway_ros2 연동 확인
3. **문서화**: 실행 방법 및 API 문서 작성

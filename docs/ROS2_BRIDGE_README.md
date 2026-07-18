# MQTT-ROS2 브릿지 사용 가이드

## 1. 개요

USV 시뮬레이터(Web)와 ROS2 시스템(oneway_ros2) 간의 양방향 데이터 브릿지입니다.

```
┌─────────────────┐                    ┌─────────────────┐                    ┌─────────────────┐
│   USV Web UI    │ ←── MQTT(WS) ───→ │  mqtt_ros2_     │ ←── ROS2 DDS ───→ │   oneway_ros2   │
│   (브라우저)      │   ws://9001      │  bridge         │   (NavSatFix,    │   (RL 추론)      │
│                 │                    │                 │    Path 등)       │                 │
└─────────────────┘                    └─────────────────┘                    └─────────────────┘
```

## 2. 설치

### 2.1 의존성 설치

```bash
# ROS2 Humble 환경
source /opt/ros/humble/setup.bash

# Python 의존성
pip install paho-mqtt

# MQTT 브로커 (Mosquitto)
sudo apt install mosquitto mosquitto-clients
```

### 2.2 패키지 빌드

```bash
cd /home/yune/ros2_ws
colcon build --packages-select mqtt_ros2_bridge
source install/setup.bash
```

## 3. 실행 방법

### 3.1 전체 시스템 실행 순서

```bash
# 터미널 1: MQTT 브로커
mosquitto -c /etc/mosquitto/mosquitto.conf -v

# 터미널 2: USV 시뮬레이터 (Web)
cd /home/yune/민철_UI/usv-simulator
npm run dev
# → http://localhost:5173/?mode=defense 접속

# 터미널 3: MQTT-ROS2 브릿지
source /opt/ros/humble/setup.bash
source /home/yune/ros2_ws/install/setup.bash
ros2 run mqtt_ros2_bridge usv_bridge

# 터미널 4: oneway_ros2 RL 추론 (선택)
ros2 launch oneway_ros2 oneway.launch.py
```

### 3.2 Launch 파일 사용

```bash
ros2 launch mqtt_ros2_bridge bridge.launch.py \
    mqtt_host:=localhost \
    mqtt_port:=9001 \
    n_allies:=3 \
    n_enemies:=10
```

## 4. 데이터 흐름

### 4.1 USV Simulator → ROS2 (텔레메트리)

| 시뮬레이터 데이터 | MQTT 토픽 | ROS2 토픽 | 메시지 타입 |
|------------------|-----------|-----------|-------------|
| ally.{x,z} → lat,lon | `usv/ally/{i}/telemetry` | `/ally_{i}/fix` | `NavSatFix` |
| ally.heading | `usv/ally/{i}/telemetry` | `/ally_{i}/imu` | `Imu` |
| enemy.{x,z} → lat,lon | `usv/enemy/{i}/telemetry` | `/enemy_{i}/fix` | `NavSatFix` |

### 4.2 ROS2 → USV Simulator (명령)

| ROS2 토픽 | MQTT 토픽 | 시뮬레이터 동작 |
|-----------|-----------|----------------|
| `/ally_{i}/waypoints` | `usv/ally/{i}/route` | 경로 설정 |

### 4.3 좌표 변환

```
시뮬레이터 좌표 (x, z)           GPS 좌표 (lat, lon)
─────────────────────           ──────────────────
x: East (+), 0-12600m    ←→    lon: 경도 (도)
z: South (+), 0-12600m   ←→    lat: 위도 (도)

변환 기준점:
  sim (6300, 6300) = mothership = (36.47655°N, 127.48375°E)

변환 공식:
  lat = mothership_lat - (z - 6300) / 111320
  lon = mothership_lon + (x - 6300) / (111320 * cos(lat))
```

## 5. MQTT 토픽 구조

### 5.1 방어 모드 토픽

```
# 아군 텔레메트리 (개별)
usv/ally/{id}/telemetry
  payload: {"id": 0, "x": 6300, "z": 6850, "heading": 0, "speed": 144, ...}

# 적군 텔레메트리 (개별)
usv/enemy/{id}/telemetry
  payload: {"id": 0, "x": 850, "z": 6300, "heading": 90, "speed": 216, ...}

# 전체 상태 (효율적 일괄 전송)
usv/defense/state
  payload: {
    "allies": [...],
    "enemies": [...],
    "mothership": {"x": 6300, "z": 6300},
    "step": 123,
    "running": true
  }

# 아군 명령 (시뮬레이터로)
usv/ally/{id}/route
  payload: {"waypoints": [{"x": 5000, "z": 5000}, ...]}
```

## 6. 환경 변수

```bash
# MQTT 설정
export MQTT_HOST=localhost
export MQTT_PORT=9001
export MQTT_TRANSPORT=websockets

# 디바이스 ID
export DEVICE_TOKEN=sim-usv-1
export DEVICE_ID=1

# 선박 수
export N_ALLIES=3
export N_ENEMIES=10

# 발행 주기
export TELEMETRY_RATE=10.0
```

## 7. 테스트

### 7.1 MQTT 메시지 모니터링

```bash
# 모든 USV 토픽 구독
mosquitto_sub -h localhost -p 9001 -t "usv/#" -v

# 아군 텔레메트리만
mosquitto_sub -h localhost -p 9001 -t "usv/ally/+/telemetry" -v
```

### 7.2 ROS2 토픽 확인

```bash
# 토픽 목록
ros2 topic list | grep -E "ally|enemy"

# 아군 GPS 데이터
ros2 topic echo /ally_0/fix

# 적군 위치
ros2 topic echo /enemy_0/fix
```

### 7.3 웨이포인트 테스트 발행

```bash
# ROS2에서 웨이포인트 발행
ros2 topic pub /ally_0/waypoints nav_msgs/Path "{
  header: {frame_id: 'wgs84'},
  poses: [
    {pose: {position: {x: 127.48, y: 36.48, z: 0}}},
    {pose: {position: {x: 127.49, y: 36.47, z: 0}}}
  ]
}"
```

## 8. 문제 해결

### 8.1 MQTT 연결 실패

```bash
# Mosquitto WebSocket 설정 확인
cat /etc/mosquitto/mosquitto.conf
# listener 9001
# protocol websockets

# 방화벽 확인
sudo ufw allow 9001
```

### 8.2 ROS2 토픽 안 보임

```bash
# 환경 소싱 확인
source /opt/ros/humble/setup.bash
source /home/yune/ros2_ws/install/setup.bash

# 노드 확인
ros2 node list
```

### 8.3 좌표 변환 오류

- 모선 위치(mothership)가 올바르게 설정되었는지 확인
- 시뮬레이터 worldSize (12600m) 설정 확인

## 9. 향후 확장

### Phase 2: 실제 센서 통합
- GPS 수신기 ROS2 드라이버 연동
- IMU 센서 연동
- AIS 수신기 통합 (적군 탐지)

### Phase 3: 양방향 제어
- oneway_ros2 RL 추론 결과 → 시뮬레이터 자동 제어
- 실시간 RL 학습 피드백

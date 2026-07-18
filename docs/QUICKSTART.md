# USV 방어 시뮬레이터 + ROS2 빠른 시작 가이드

## 사전 준비 (최초 1회)

```bash
# Mosquitto WebSocket 설정 복사
sudo cp /home/yune/mosquitto_websocket.conf /etc/mosquitto/conf.d/websocket.conf
sudo systemctl restart mosquitto
```

---

## 실행 방법

### 터미널 1: MQTT 브로커
```bash
sudo systemctl start mosquitto
```

### 터미널 2: USV 시뮬레이터
```bash
cd /home/yune/민철_UI/usv-simulator
npm run dev
```
→ http://localhost:5173/?mode=defense 접속

### 터미널 3: ROS2 브릿지
```bash
source /opt/ros/humble/setup.bash
source /home/yune/ros2_ws/install/setup.bash
ros2 run mqtt_ros2_bridge usv_bridge
```

### 터미널 4: RL 추론 (선택)
```bash
source /opt/ros/humble/setup.bash
source /home/yune/ros2_ws/install/setup.bash
ros2 launch oneway_ros2 oneway.launch.py
```

---

## 테스트

```bash
cd /home/yune/민철_UI/usv-simulator

# MQTT 연결 테스트 (메시지 모니터링)
python3 scripts/test_mqtt_bridge.py

# 웨이포인트 발행 테스트
python3 scripts/test_mqtt_bridge.py --waypoint

# 시뮬레이션 시작/정지
python3 scripts/test_mqtt_bridge.py --start
python3 scripts/test_mqtt_bridge.py --stop
```

---

## 데이터 흐름

```
┌─────────────┐     MQTT (9001)     ┌─────────────┐      ROS2       ┌─────────────┐
│  브라우저    │ ←────────────────→ │ mqtt_ros2_  │ ←─────────────→ │ oneway_ros2 │
│ (방어 모드)  │                    │   bridge    │                 │  (RL 추론)   │
└─────────────┘                     └─────────────┘                 └─────────────┘
```

---

## MQTT 토픽

| 토픽 | 방향 | 내용 |
|------|------|------|
| `usv/ally/{id}/telemetry` | 시뮬→ROS2 | 아군 위치/헤딩 |
| `usv/enemy/{id}/telemetry` | 시뮬→ROS2 | 적군 위치 |
| `usv/defense/state` | 시뮬→ROS2 | 전체 상태 |
| `usv/ally/{id}/route` | ROS2→시뮬 | 웨이포인트 |
| `usv/system/commands` | ROS2→시뮬 | start/stop/reset |
| `usv/commander/state` | ROS2→시뮬 | 지휘관 판단 (MobRobGPT 스타일) |

---

## 지휘관 판단 패널 (MobRobGPT 스타일)

RL 추론 결과를 MobRobGPT의 `run_commander_ui.py --cell`과 동일하게 표시:

### 표시 항목
- **모델명/상태**: oneway_ros2 (RL), ready/calling/error
- **명령 입력**: 프롬프트 전송
- **적 클러스터 탐지**: 클러스터별 방위각, 적 수, 위협도
- **투입 배분**: 아군 → 클러스터 할당 (active/reserve/stopped)
- **판단 근거**: RL 정책의 결정 이유
- **TF 겹침 범례**: 1개/2개/3개+ 겹침 영역

### 데이터 흐름
```
oneway_ros2 (RL 추론)
    ↓ Path 발행
usv_bridge (ROS2 노드)
    ↓ MQTT usv/commander/state
USV 시뮬레이터 (CommanderPanel)
```

---

## 문제 해결

### Mosquitto 연결 안됨
```bash
# 상태 확인
sudo systemctl status mosquitto

# 로그 확인
sudo tail -f /var/log/mosquitto/mosquitto.log
```

### ROS2 패키지 못 찾음
```bash
# 다시 빌드
cd /home/yune/ros2_ws
colcon build --packages-select mqtt_ros2_bridge
source install/setup.bash
```

### 시뮬레이터 화면 안 나옴
```bash
# 브라우저 강제 새로고침: Ctrl+Shift+R
# 또는 캐시 삭제 후 재접속
```

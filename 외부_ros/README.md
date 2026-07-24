# 외부 시뮬레이터 테스트

MQTT로 데이터를 발행하여 bridge 모드에서 시각화하는 테스트 코드입니다.

## 의존성

```bash
pip install paho-mqtt
```

## 사용법

### 1. Mosquitto WebSocket 실행

```bash
sudo systemctl start mosquitto
```

### 2. 외부 시뮬레이터 실행

```bash
# 양동 공격 (기본)
python external_simulator.py --formation diversionary

# 집중 공격
python external_simulator.py --formation concentrated

# 파상 공격
python external_simulator.py --formation wave
```

### 3. 브라우저에서 확인

```
http://localhost:5173/?mode=bridge
```

## 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--formation` | diversionary | 포메이션: concentrated, diversionary, wave |
| `--mqtt-host` | localhost | MQTT 브로커 호스트 |
| `--mqtt-port` | 9001 | MQTT WebSocket 포트 |
| `--fps` | 30 | 발행 주기 (Hz) |

## 포메이션

- **concentrated (집중)**: 한 방위에서 10대 밀집 공격
- **diversionary (양동)**: 3그룹으로 분산 (3:4:3 비율)
- **wave (파상)**: 3단계 시차 공격 (거리별)

## MQTT 토픽

발행:
- `usv/defense/state` - 전체 상태 (적군/아군/모선)

## 데이터 구조

```json
{
  "allies": [
    {"id": 0, "x": 15.5, "z": 18.0, "heading": 0, "speed": 0.14, "alive": true, ...}
  ],
  "enemies": [
    {"id": 0, "x": 20.0, "z": 5.0, "heading": 180, "speed": 0.3, "alive": true, ...}
  ],
  "mothership": {"x": 16.5, "z": 16.5, "radius": 0.68},
  "step": 123,
  "running": true,
  "done": false
}
```

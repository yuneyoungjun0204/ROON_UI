#!/usr/bin/env python3
"""
MQTT 브릿지 테스트 스크립트
USV 시뮬레이터와 ROS2 브릿지 간의 MQTT 통신을 테스트합니다.
"""

import json
import time
import argparse
import paho.mqtt.client as mqtt


def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print("[OK] MQTT 브로커 연결 성공")
        # 모든 USV 토픽 구독
        client.subscribe("usv/#")
        print("[구독] usv/# 토픽 구독 시작")
    else:
        print(f"[ERROR] 연결 실패: rc={rc}")


def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
        topic = msg.topic

        # 토픽별 출력 포맷
        if "ally" in topic and "telemetry" in topic:
            if "lat" in payload:
                print(f"  [아군] id={payload.get('id')}, "
                      f"lat={payload.get('lat', 0):.6f}, "
                      f"lon={payload.get('lon', 0):.6f}, "
                      f"heading={payload.get('heading', 0):.1f}°")
        elif "enemy" in topic and "telemetry" in topic:
            if "lat" in payload:
                print(f"  [적군] id={payload.get('id')}, "
                      f"lat={payload.get('lat', 0):.6f}, "
                      f"lon={payload.get('lon', 0):.6f}")
        elif topic == "usv/defense/state":
            allies = payload.get("allies", [])
            enemies = payload.get("enemies", [])
            step = payload.get("step", 0)
            running = payload.get("running", False)
            print(f"\n[전체 상태] step={step}, running={running}, "
                  f"allies={len(allies)}, enemies={len([e for e in enemies if e.get('alive')])} alive")
        else:
            print(f"[{topic}] {json.dumps(payload, ensure_ascii=False)[:100]}")

    except json.JSONDecodeError:
        print(f"[{msg.topic}] (non-JSON) {msg.payload[:50]}")


def test_publish_waypoint(client, ally_id=0):
    """테스트 웨이포인트 발행"""
    waypoints = {
        "waypoints": [
            {"x": 5000, "z": 5000},
            {"x": 4500, "z": 5500},
            {"x": 5500, "z": 6000},
        ],
        "source": "test_script"
    }
    topic = f"usv/ally/{ally_id}/route"
    client.publish(topic, json.dumps(waypoints))
    print(f"[발행] {topic}: {len(waypoints['waypoints'])}개 웨이포인트")


def test_system_command(client, command):
    """시스템 명령 발행"""
    payload = {"command": command}
    client.publish("usv/system/commands", json.dumps(payload))
    print(f"[명령] usv/system/commands: {command}")


def main():
    parser = argparse.ArgumentParser(description="MQTT 브릿지 테스트")
    parser.add_argument("--host", default="localhost", help="MQTT 브로커 호스트")
    parser.add_argument("--port", type=int, default=9001, help="MQTT 브로커 포트")
    parser.add_argument("--transport", default="websockets", choices=["tcp", "websockets"])
    parser.add_argument("--waypoint", action="store_true", help="테스트 웨이포인트 발행")
    parser.add_argument("--start", action="store_true", help="시뮬레이션 시작 명령")
    parser.add_argument("--stop", action="store_true", help="시뮬레이션 정지 명령")
    parser.add_argument("--reset", action="store_true", help="시뮬레이션 리셋 명령")
    args = parser.parse_args()

    print(f"MQTT 브로커: {args.host}:{args.port} ({args.transport})")
    print("-" * 50)

    client = mqtt.Client(
        client_id="mqtt_test_client",
        transport=args.transport,
        protocol=mqtt.MQTTv5 if args.transport == "websockets" else mqtt.MQTTv311
    )
    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(args.host, args.port, keepalive=60)
        client.loop_start()

        time.sleep(1)  # 연결 대기

        # 명령 처리
        if args.waypoint:
            test_publish_waypoint(client, 0)
        if args.start:
            test_system_command(client, "start")
        if args.stop:
            test_system_command(client, "stop")
        if args.reset:
            test_system_command(client, "reset")

        # 메시지 수신 대기
        print("\n[대기] 메시지 수신 중... (Ctrl+C로 종료)")
        while True:
            time.sleep(0.1)

    except KeyboardInterrupt:
        print("\n[종료]")
    except Exception as e:
        print(f"[ERROR] {e}")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
외부 시뮬레이터 테스트 코드
- MQTT로 적군/아군 데이터 발행
- bridge 모드 (?mode=bridge)에서 시각화
- 집중(concentrated), 파상(wave), 양동(diversionary) 포메이션 지원

사용법:
  python external_simulator.py --formation diversionary
  python external_simulator.py --formation concentrated
  python external_simulator.py --formation wave

브라우저:
  http://localhost:5173/?mode=bridge
"""

import json
import math
import time
import random
import argparse
from dataclasses import dataclass, field, asdict
from typing import List, Optional

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("paho-mqtt 설치 필요: pip install paho-mqtt")
    exit(1)


# ═══════════════════════════════════════════════════════════════════════════
# 설정 (defense.ts와 동일)
# ═══════════════════════════════════════════════════════════════════════════

SCALE = 33 / 12600  # ≈ 0.00262

CONFIG = {
    "worldSize": 33.0,  # m
    "gridSize": 200,

    # 모선
    "mothership": {
        "x": 16.5,  # 중앙
        "z": 16.5,
        "radius": 260 * SCALE,  # breach 반경
    },

    # 적
    "nEnemies": 10,
    "enemySpeed": 0.3,  # m/s
    "enemyMaxTurn": 5,  # deg/s
    "enemyWeaveAmp": 14,  # 위빙 진폭 (deg)

    # 아군
    "nAllies": 3,
    "allySpeed": 0.14,  # m/s
    "allyMaxTurn": 8,  # deg/s
    "allyRowGap": 550 * SCALE,
    "allySideSpacing": 330 * SCALE,
    "netsPerShip": 3,

    # 포메이션
    "formations": {
        "spawnRadius": 5450 * SCALE,  # ~14.3m
        "groupJitter": 150 * SCALE,   # ~0.39m
        "waveRanks": 3,
        "waveGap": 1000 * SCALE,      # ~2.6m
        "waveNear": 4000 * SCALE,     # ~10.5m
        "waveSpread": 18,             # deg
    },
}


# ═══════════════════════════════════════════════════════════════════════════
# 데이터 클래스
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class Enemy:
    id: int
    x: float
    z: float
    heading: float
    speed: float
    alive: bool = True
    phase: float = 0.0

    def to_dict(self):
        return asdict(self)


@dataclass
class Ally:
    id: int
    x: float
    z: float
    heading: float
    speed: float = 0.0
    alive: bool = True
    netsRemaining: int = 3
    painting: bool = False
    paintDist: float = 0.0
    route: List[dict] = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


# ═══════════════════════════════════════════════════════════════════════════
# 스폰 함수 (formations.ts 포팅)
# ═══════════════════════════════════════════════════════════════════════════

def spawn_concentrated() -> List[Enemy]:
    """집중 공격: 한 방위에서 10대 밀집"""
    center = CONFIG["worldSize"] / 2
    bearing = random.random() * 360
    bearing_rad = math.radians(bearing)
    enemies = []

    for i in range(CONFIG["nEnemies"]):
        jitter_x = (random.random() - 0.5) * 2 * CONFIG["formations"]["groupJitter"]
        jitter_z = (random.random() - 0.5) * 2 * CONFIG["formations"]["groupJitter"]

        x = center + math.sin(bearing_rad) * CONFIG["formations"]["spawnRadius"] + jitter_x
        z = center - math.cos(bearing_rad) * CONFIG["formations"]["spawnRadius"] + jitter_z

        heading_to_mother = math.degrees(math.atan2(center - x, z - center))
        heading = (heading_to_mother % 360 + 360) % 360

        enemies.append(Enemy(
            id=i,
            x=x,
            z=z,
            heading=heading,
            speed=CONFIG["enemySpeed"],
            phase=random.random() * math.pi * 2,
        ))

    return enemies


def spawn_diversionary() -> List[Enemy]:
    """양동 공격: 3그룹으로 분산 (3:4:3 비율)"""
    center = CONFIG["worldSize"] / 2
    base_bearing = random.random() * 360
    bearings = [
        base_bearing,
        (base_bearing + 120) % 360,
        (base_bearing + 240) % 360,
    ]
    distribution = [3, 4, 3]
    enemies = []
    id_counter = 0

    for g in range(3):
        bearing_rad = math.radians(bearings[g])

        for _ in range(distribution[g]):
            jitter_x = (random.random() - 0.5) * 2 * CONFIG["formations"]["groupJitter"]
            jitter_z = (random.random() - 0.5) * 2 * CONFIG["formations"]["groupJitter"]

            x = center + math.sin(bearing_rad) * CONFIG["formations"]["spawnRadius"] + jitter_x
            z = center - math.cos(bearing_rad) * CONFIG["formations"]["spawnRadius"] + jitter_z

            heading_to_mother = math.degrees(math.atan2(center - x, z - center))
            heading = (heading_to_mother % 360 + 360) % 360

            enemies.append(Enemy(
                id=id_counter,
                x=x,
                z=z,
                heading=heading,
                speed=CONFIG["enemySpeed"],
                phase=random.random() * math.pi * 2,
            ))
            id_counter += 1

    return enemies


def spawn_wave() -> List[Enemy]:
    """파상 공격: 3단계 시차 공격"""
    center = CONFIG["worldSize"] / 2
    base_bearing = random.random() * 360
    distribution = [4, 3, 3]
    enemies = []
    id_counter = 0

    for rank in range(CONFIG["formations"]["waveRanks"]):
        distance = CONFIG["formations"]["waveNear"] + rank * CONFIG["formations"]["waveGap"]
        bearing_offset = (rank - 1) * CONFIG["formations"]["waveSpread"]
        bearing = base_bearing + bearing_offset
        bearing_rad = math.radians(bearing)

        for _ in range(distribution[rank]):
            jitter_x = (random.random() - 0.5) * 2 * CONFIG["formations"]["groupJitter"]
            jitter_z = (random.random() - 0.5) * 2 * CONFIG["formations"]["groupJitter"]

            x = center + math.sin(bearing_rad) * distance + jitter_x
            z = center - math.cos(bearing_rad) * distance + jitter_z

            heading_to_mother = math.degrees(math.atan2(center - x, z - center))
            heading = (heading_to_mother % 360 + 360) % 360

            enemies.append(Enemy(
                id=id_counter,
                x=x,
                z=z,
                heading=heading,
                speed=CONFIG["enemySpeed"],
                phase=random.random() * math.pi * 2,
            ))
            id_counter += 1

    return enemies


def spawn_allies() -> List[Ally]:
    """아군 스폰: 모선 후미에 횡렬 배치"""
    center = CONFIG["worldSize"] / 2
    row_z = center + CONFIG["allyRowGap"]
    start_x = center - ((CONFIG["nAllies"] - 1) * CONFIG["allySideSpacing"]) / 2
    allies = []

    for i in range(CONFIG["nAllies"]):
        ally_x = start_x + i * CONFIG["allySideSpacing"]

        # 테스트용 경로
        route = [
            {"x": ally_x, "z": center - CONFIG["worldSize"] * 0.2, "paint": True},
            {"x": ally_x, "z": center - CONFIG["worldSize"] * 0.35, "paint": False},
        ]

        allies.append(Ally(
            id=i,
            x=ally_x,
            z=row_z,
            heading=0,  # 북쪽
            speed=0,
            netsRemaining=CONFIG["netsPerShip"],
            route=route,
        ))

    return allies


# ═══════════════════════════════════════════════════════════════════════════
# 시뮬레이션 업데이트
# ═══════════════════════════════════════════════════════════════════════════

def update_enemy(enemy: Enemy, dt: float, elapsed: float, mothership: dict) -> None:
    """적 이동 업데이트"""
    if not enemy.alive:
        return

    # 모선 방향
    dx = mothership["x"] - enemy.x
    dz = mothership["z"] - enemy.z
    target_heading = math.degrees(math.atan2(dx, -dz))

    # 위빙
    weave = CONFIG["enemyWeaveAmp"] * 0.3 * math.sin(enemy.phase + elapsed * 0.8)
    desired_heading = target_heading + weave

    # 헤딩 차이
    heading_diff = ((desired_heading - enemy.heading + 540) % 360) - 180
    max_turn = CONFIG["enemyMaxTurn"] * dt
    heading_diff = max(-max_turn, min(max_turn, heading_diff))

    enemy.heading = (enemy.heading + heading_diff + 360) % 360
    heading_rad = math.radians(enemy.heading)

    # 이동
    enemy.x += math.sin(heading_rad) * enemy.speed * dt
    enemy.z -= math.cos(heading_rad) * enemy.speed * dt

    # 돌파 체크
    dist_to_mother = math.hypot(enemy.x - mothership["x"], enemy.z - mothership["z"])
    if dist_to_mother < mothership["radius"]:
        enemy.alive = False
        print(f"[SIM] ⚠ 적 {enemy.id} 돌파!")


def update_ally(ally: Ally, dt: float) -> None:
    """아군 이동 업데이트"""
    if not ally.alive or not ally.route:
        return

    target = ally.route[0]
    dx = target["x"] - ally.x
    dz = target["z"] - ally.z
    dist = math.hypot(dx, dz)

    # 도착 판정
    arrival_dist = 0.5  # m
    if dist < arrival_dist:
        completed = ally.route.pop(0)
        print(f"[SIM] Ally {ally.id}: WP 도착 ({completed['x']:.2f}, {completed['z']:.2f})")

        # 그물 전개 시작/종료
        if completed.get("paint") and not ally.painting and ally.netsRemaining > 0:
            ally.painting = True
            ally.paintDist = 0
            print(f"[SIM] Ally {ally.id}: ★ 그물 전개 시작!")
        elif ally.painting and (not ally.route or not ally.route[0].get("paint")):
            ally.painting = False
            ally.netsRemaining -= 1
            print(f"[SIM] Ally {ally.id}: ★ 그물 전개 완료! 남은 그물={ally.netsRemaining}")

        return

    # 목표 방향
    target_heading = math.degrees(math.atan2(dx, -dz))
    heading_diff = ((target_heading - ally.heading + 540) % 360) - 180
    max_turn = CONFIG["allyMaxTurn"] * dt
    heading_diff = max(-max_turn, min(max_turn, heading_diff))

    ally.heading = (ally.heading + heading_diff + 360) % 360
    heading_rad = math.radians(ally.heading)

    # 가속
    target_speed = CONFIG["allySpeed"]
    accel = 1.5
    if ally.speed < target_speed:
        ally.speed = min(target_speed, ally.speed + accel * dt)

    # 이동
    ally.x += math.sin(heading_rad) * ally.speed * dt
    ally.z -= math.cos(heading_rad) * ally.speed * dt

    # 그물 거리 누적
    if ally.painting:
        ally.paintDist += ally.speed * dt


# ═══════════════════════════════════════════════════════════════════════════
# MQTT 발행
# ═══════════════════════════════════════════════════════════════════════════

def publish_state(client: mqtt.Client, enemies: List[Enemy], allies: List[Ally],
                  mothership: dict, step: int, running: bool):
    """전체 상태 MQTT 발행"""
    state = {
        "allies": [a.to_dict() for a in allies],
        "enemies": [e.to_dict() for e in enemies],
        "mothership": mothership,
        "netInstalled": [],  # 그물 격자 (간단화)
        "gridSize": CONFIG["gridSize"],
        "step": step,
        "running": running,
        "done": all(not e.alive for e in enemies),
        "stats": {
            "captures": sum(1 for e in enemies if not e.alive),
            "breaches": 0,
            "netsUsed": sum(CONFIG["netsPerShip"] - a.netsRemaining for a in allies),
        },
        "ts": int(time.time()),
    }

    client.publish("usv/defense/state", json.dumps(state), qos=0)


# ═══════════════════════════════════════════════════════════════════════════
# 메인
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="외부 시뮬레이터")
    parser.add_argument("--formation", type=str, default="diversionary",
                        choices=["concentrated", "diversionary", "wave"],
                        help="포메이션: concentrated(집중), diversionary(양동), wave(파상)")
    parser.add_argument("--mqtt-host", type=str, default="localhost")
    parser.add_argument("--mqtt-port", type=int, default=9001)
    parser.add_argument("--fps", type=int, default=30, help="발행 주기 (Hz)")
    args = parser.parse_args()

    # 포메이션별 스폰
    print(f"[SIM] 포메이션: {args.formation}")
    if args.formation == "concentrated":
        enemies = spawn_concentrated()
    elif args.formation == "wave":
        enemies = spawn_wave()
    else:
        enemies = spawn_diversionary()

    allies = spawn_allies()
    mothership = CONFIG["mothership"]

    print(f"[SIM] 적군 {len(enemies)}대, 아군 {len(allies)}대 스폰 완료")

    # MQTT 연결
    client = mqtt.Client(transport="websockets")
    try:
        client.connect(args.mqtt_host, args.mqtt_port)
        client.loop_start()
        print(f"[SIM] MQTT 연결 성공: ws://{args.mqtt_host}:{args.mqtt_port}")
    except Exception as e:
        print(f"[SIM] MQTT 연결 실패: {e}")
        print("  Mosquitto WebSocket이 실행 중인지 확인하세요:")
        print("    sudo systemctl start mosquitto")
        return

    # 시뮬레이션 루프
    dt = 1.0 / args.fps
    step = 0
    running = True
    start_time = time.time()

    print(f"[SIM] 시뮬레이션 시작 (Ctrl+C로 종료)")
    print(f"[SIM] 브라우저: http://localhost:5173/?mode=bridge")

    try:
        while running:
            elapsed = time.time() - start_time

            # 적 업데이트
            for enemy in enemies:
                update_enemy(enemy, dt, elapsed, mothership)

            # 아군 업데이트
            for ally in allies:
                update_ally(ally, dt)

            # MQTT 발행
            publish_state(client, enemies, allies, mothership, step, running)

            # 종료 조건
            if all(not e.alive for e in enemies):
                print("[SIM] 모든 적 제거! 시뮬레이션 종료")
                running = False

            step += 1
            time.sleep(dt)

    except KeyboardInterrupt:
        print("\n[SIM] 종료됨")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()

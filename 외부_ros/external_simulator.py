#!/usr/bin/env python3
"""
외부 시뮬레이터 (ROS2 노드)
- ROS2 토픽으로 적군/아군 데이터 발행
- mqtt_ros2_bridge를 통해 MQTT로 변환
- bridge 모드 (?mode=bridge)에서 시각화

사용법:
  # ROS2 환경 소싱
  source /opt/ros/humble/setup.zsh
  source /home/yune/ros2_ws/install/setup.zsh

  # 실행
  python3 external_simulator.py

  # 포메이션 변경: 집중, 양동, 파상 입력

브라우저:
  http://localhost:5173/?mode=bridge
"""

import json
import math
import time
import random
import argparse
import threading
import queue
from dataclasses import dataclass, field, asdict
from typing import List

# ROS2
try:
    import rclpy
    from rclpy.node import Node
    from std_msgs.msg import String
    from sensor_msgs.msg import NavSatFix, Imu
    from geometry_msgs.msg import Quaternion
    ROS2_AVAILABLE = True
except ImportError:
    print("ROS2를 찾을 수 없습니다. 환경을 소싱하세요:")
    print("  source /opt/ros/humble/setup.zsh")
    ROS2_AVAILABLE = False


# GPS 원점 (모선 위치 - usv_bridge와 동일)
MOTHER_LAT = 34.625    # 남해 매물도 근해
MOTHER_LON = 128.52


def sim_to_gps(x: float, z: float) -> tuple:
    """시뮬레이터 좌표 → GPS 변환"""
    sim_center = CONFIG["worldSize"] / 2
    meters_per_deg_lat = 111320
    meters_per_deg_lon = 111320 * math.cos(math.radians(MOTHER_LAT))

    dx = x - sim_center
    dz = z - sim_center

    lat = MOTHER_LAT - dz / meters_per_deg_lat
    lon = MOTHER_LON + dx / meters_per_deg_lon

    return lat, lon


def heading_to_quaternion(heading_deg: float) -> Quaternion:
    """Heading(deg) → Quaternion (ENU 좌표계)"""
    # NAV convention (0=North, CW+) → ENU (0=East, CCW+)
    yaw_enu = math.radians(90 - heading_deg)
    q = Quaternion()
    q.x = 0.0
    q.y = 0.0
    q.z = math.sin(yaw_enu / 2)
    q.w = math.cos(yaw_enu / 2)
    return q


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
    """아군 스폰: 모선 후미에 횡렬 배치 (WP 명령 대기)"""
    center = CONFIG["worldSize"] / 2
    row_z = center + CONFIG["allyRowGap"]
    start_x = center - ((CONFIG["nAllies"] - 1) * CONFIG["allySideSpacing"]) / 2
    allies = []

    for i in range(CONFIG["nAllies"]):
        ally_x = start_x + i * CONFIG["allySideSpacing"]

        # 초기 경로 없음 - WP 명령 대기
        allies.append(Ally(
            id=i,
            x=ally_x,
            z=row_z,
            heading=0,  # 북쪽
            speed=0,
            netsRemaining=CONFIG["netsPerShip"],
            route=[],  # 빈 경로 - 명령 대기
        ))

    return allies


def spawn_by_formation(formation: str):
    """포메이션별 스폰"""
    if formation == "concentrated" or formation == "집중":
        return spawn_concentrated(), "집중 공격"
    elif formation == "wave" or formation == "파상":
        return spawn_wave(), "파상 공격"
    else:  # diversionary, 양동
        return spawn_diversionary(), "양동 공격"


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
# ROS2 노드
# ═══════════════════════════════════════════════════════════════════════════

class ExternalSimulatorNode(Node):
    """외부 시뮬레이터 ROS2 노드"""

    def __init__(self, formation: str = "diversionary", fps: int = 30):
        super().__init__("external_simulator")

        self.fps = fps
        self.dt = 1.0 / fps
        self.formation_name = ""
        self.mothership = CONFIG["mothership"]

        # 스폰
        self.enemies, self.formation_name = spawn_by_formation(formation)
        self.allies = spawn_allies()
        self.step = 0
        self.start_time = time.time()
        self.running = True
        self.netInstalled = []  # 설치된 그물 셀 좌표 [(i, j), ...]

        # ROS2 퍼블리셔: /sim/defense/state (JSON)
        self.state_pub = self.create_publisher(String, "/sim/defense/state", 10)

        # 아군 퍼블리셔: /ally_{i}/fix, /ally_{i}/imu
        self.ally_fix_pubs = []
        self.ally_imu_pubs = []
        for i in range(CONFIG["nAllies"]):
            self.ally_fix_pubs.append(
                self.create_publisher(NavSatFix, f"/ally_{i}/fix", 10)
            )
            self.ally_imu_pubs.append(
                self.create_publisher(Imu, f"/ally_{i}/imu", 10)
            )

        # 적군 퍼블리셔: /enemy_{i}/fix
        self.enemy_fix_pubs = []
        for i in range(CONFIG["nEnemies"]):
            self.enemy_fix_pubs.append(
                self.create_publisher(NavSatFix, f"/enemy_{i}/fix", 10)
            )

        # 모선 퍼블리셔: /mothership/fix
        self.mothership_fix_pub = self.create_publisher(NavSatFix, "/mothership/fix", 10)

        # 아군 웨이포인트 구독: /ally_{i}/waypoints
        from nav_msgs.msg import Path
        self.wp_subs = []
        for i in range(CONFIG["nAllies"]):
            self.wp_subs.append(
                self.create_subscription(
                    Path,
                    f"/ally_{i}/waypoints",
                    lambda msg, idx=i: self._on_waypoints(msg, idx),
                    10
                )
            )

        # 시스템 명령 구독: /sim/commands (리셋 등)
        self.cmd_sub = self.create_subscription(
            String,
            "/sim/commands",
            self._on_command,
            10
        )

        # 타이머
        self.timer = self.create_timer(self.dt, self.tick)

        # 입력 큐 (포메이션 변경용)
        self.input_queue = queue.Queue()
        self.input_thread = threading.Thread(target=self._input_loop, daemon=True)
        self.input_thread.start()

        self.get_logger().info(f"외부 시뮬레이터 시작: {self.formation_name}")
        self.get_logger().info(f"  적군 {len(self.enemies)}대, 아군 {len(self.allies)}대")
        self.get_logger().info("  포메이션 변경: 집중, 양동, 파상 입력")
        self.get_logger().info("  웨이포인트 토픽: /ally_{i}/waypoints")
        self.get_logger().info("  브라우저: http://localhost:5173/?mode=bridge")

    def _on_command(self, msg):
        """시스템 명령 수신 (리셋 등)"""
        try:
            data = json.loads(msg.data)
            cmd = data.get("command", "")
        except json.JSONDecodeError:
            cmd = msg.data.strip()

        if cmd == "reset":
            self.get_logger().info("★ 리셋 명령 수신 - 상태 초기화")
            self.reset_simulation()

    def reset_simulation(self):
        """시뮬레이션 완전 초기화"""
        self.enemies, self.formation_name = spawn_by_formation(self.formation_name)
        self.allies = spawn_allies()
        self.netInstalled = []  # 그물 초기화
        self.step = 0
        self.start_time = time.time()
        self.get_logger().info(f"★ 초기화 완료: {self.formation_name}")

    def _on_waypoints(self, msg, ally_idx: int):
        """웨이포인트 명령 수신"""
        from nav_msgs.msg import Path

        if ally_idx >= len(self.allies):
            return

        ally = self.allies[ally_idx]
        new_route = []

        for pose in msg.poses:
            # GPS 좌표 → 시뮬레이터 좌표
            lat = pose.pose.position.y
            lon = pose.pose.position.x

            sim_center = CONFIG["worldSize"] / 2
            meters_per_deg_lat = 111320
            meters_per_deg_lon = 111320 * math.cos(math.radians(MOTHER_LAT))

            dlat = lat - MOTHER_LAT
            dlon = lon - MOTHER_LON

            x = sim_center + dlon * meters_per_deg_lon
            z = sim_center - dlat * meters_per_deg_lat

            new_route.append({"x": x, "z": z, "paint": False})

        if new_route:
            ally.route = new_route
            self.get_logger().info(f"Ally {ally_idx}: 웨이포인트 {len(new_route)}개 수신")

    def _input_loop(self):
        """입력 스레드"""
        while True:
            try:
                line = input()
                self.input_queue.put(line.strip())
            except EOFError:
                break

    def tick(self):
        """시뮬레이션 틱"""
        # 입력 체크
        try:
            while not self.input_queue.empty():
                cmd = self.input_queue.get_nowait()
                if cmd in ["집중", "concentrated", "양동", "diversionary", "파상", "wave"]:
                    self.enemies, self.formation_name = spawn_by_formation(cmd)
                    self.allies = spawn_allies()
                    self.netInstalled = []  # 그물도 초기화
                    self.step = 0
                    self.start_time = time.time()
                    self.get_logger().info(f"★ 재생성: {self.formation_name}")
                elif cmd in ["리셋", "reset"]:
                    self.reset_simulation()
                elif cmd:
                    self.get_logger().info(f"알 수 없는 명령: {cmd} (사용: 집중, 양동, 파상)")
        except Exception:
            pass

        elapsed = time.time() - self.start_time

        # 적 업데이트
        for enemy in self.enemies:
            update_enemy(enemy, self.dt, elapsed, self.mothership)

        # 아군 업데이트
        for ally in self.allies:
            update_ally(ally, self.dt)

        # ROS2 발행
        self.publish_state()

        # 모든 적 제거 시 재생성
        if all(not e.alive for e in self.enemies):
            self.get_logger().info(f"모든 적 제거! {self.formation_name}으로 재생성...")
            self.enemies, _ = spawn_by_formation(self.formation_name)
            self.allies = spawn_allies()
            self.netInstalled = []  # 그물도 초기화
            self.step = 0
            self.start_time = time.time()

        self.step += 1

    def publish_state(self):
        """ROS2 토픽 발행"""
        now = self.get_clock().now().to_msg()

        # 아군 개별 토픽 발행
        for ally in self.allies:
            if ally.id < len(self.ally_fix_pubs):
                lat, lon = sim_to_gps(ally.x, ally.z)

                # NavSatFix
                fix = NavSatFix()
                fix.header.stamp = now
                fix.header.frame_id = "wgs84"
                fix.latitude = lat
                fix.longitude = lon
                fix.altitude = 0.0
                self.ally_fix_pubs[ally.id].publish(fix)

                # Imu (heading)
                imu = Imu()
                imu.header.stamp = now
                imu.header.frame_id = f"ally_{ally.id}"
                imu.orientation = heading_to_quaternion(ally.heading)
                self.ally_imu_pubs[ally.id].publish(imu)

        # 적군 개별 토픽 발행
        for enemy in self.enemies:
            if enemy.id < len(self.enemy_fix_pubs) and enemy.alive:
                lat, lon = sim_to_gps(enemy.x, enemy.z)

                fix = NavSatFix()
                fix.header.stamp = now
                fix.header.frame_id = "wgs84"
                fix.latitude = lat
                fix.longitude = lon
                fix.altitude = 0.0
                self.enemy_fix_pubs[enemy.id].publish(fix)

        # 모선 토픽 발행
        fix = NavSatFix()
        fix.header.stamp = now
        fix.header.frame_id = "wgs84"
        fix.latitude = MOTHER_LAT
        fix.longitude = MOTHER_LON
        fix.altitude = 0.0
        self.mothership_fix_pub.publish(fix)

        # 전체 상태 (JSON)
        state = {
            "allies": [a.to_dict() for a in self.allies],
            "enemies": [e.to_dict() for e in self.enemies],
            "mothership": self.mothership,
            "netInstalled": self.netInstalled,
            "gridSize": CONFIG["gridSize"],
            "step": self.step,
            "running": self.running,
            "done": all(not e.alive for e in self.enemies),
            "stats": {
                "captures": sum(1 for e in self.enemies if not e.alive),
                "breaches": 0,
                "netsUsed": sum(CONFIG["netsPerShip"] - a.netsRemaining for a in self.allies),
            },
            "ts": int(time.time()),
        }

        msg = String()
        msg.data = json.dumps(state)
        self.state_pub.publish(msg)


# ═══════════════════════════════════════════════════════════════════════════
# 메인
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="외부 시뮬레이터 (ROS2)")
    parser.add_argument("--formation", type=str, default="diversionary",
                        choices=["concentrated", "diversionary", "wave"],
                        help="초기 포메이션")
    parser.add_argument("--fps", type=int, default=30, help="발행 주기 (Hz)")
    args = parser.parse_args()

    if not ROS2_AVAILABLE:
        print("ROS2 환경을 소싱하세요:")
        print("  source /opt/ros/humble/setup.zsh")
        return

    rclpy.init()
    node = ExternalSimulatorNode(formation=args.formation, fps=args.fps)

    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()

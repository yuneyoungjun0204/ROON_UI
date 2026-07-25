// ─────────────────────────────────────────────────────────────────────────
// 방어 시뮬레이터 MQTT 연동
// - 다중 선박 텔레메트리 발행 (아군 3대, 적군 10대, 모선)
// - ROS2 브릿지로부터 웨이포인트 명령 수신
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import mqtt from "mqtt";
import { config } from "../config";
import { useDefenseStore } from "../defenseStore";
import { DEFENSE_CONFIG as C, GPS_ORIGIN } from "../config/defense";

type MqttClientType = ReturnType<typeof mqtt.connect>;

/** 시뮬레이터 좌표 → GPS 변환 */
function simToGps(x: number, z: number, motherLat: number, motherLon: number) {
  const simCenter = C.worldSize / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos((motherLat * Math.PI) / 180);

  const dx = x - simCenter;
  const dz = z - simCenter;

  const lat = motherLat - dz / metersPerDegLat;
  const lon = motherLon + dx / metersPerDegLon;

  return { lat, lon };
}

/** GPS → 시뮬레이터 좌표 변환 */
function gpsToSim(lat: number, lon: number, motherLat: number, motherLon: number) {
  const simCenter = C.worldSize / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos((motherLat * Math.PI) / 180);

  const dlat = lat - motherLat;
  const dlon = lon - motherLon;

  const x = simCenter + dlon * metersPerDegLon;
  const z = simCenter - dlat * metersPerDegLat;

  return { x, z };
}

/** 방어 모드 MQTT 훅 */
export function useDefenseMqtt(): void {
  const clientRef = useRef<MqttClientType | null>(null);

  useEffect(() => {
    // 설정에서 MQTT가 비활성화되면 연결하지 않음
    if (config.telemetryTransport !== "mqtt" && !config.enableMqttCommands) {
      return;
    }

    const client = mqtt.connect(config.mqttUrl, {
      username: config.mqttUsername || undefined,
      password: config.mqttPassword || undefined,
      reconnectPeriod: 3000,
      connectTimeout: 5000,
    });
    clientRef.current = client;

    // 모선 GPS 기준점 (defense.ts에서 로드)
    const motherLat = GPS_ORIGIN.lat;
    const motherLon = GPS_ORIGIN.lon;

    client.on("connect", () => {
      console.log("[DefenseMQTT] 연결됨");

      // 명령 토픽 구독
      for (let i = 0; i < C.nAllies; i++) {
        client.subscribe(`usv/ally/${i}/route`, { qos: 1 });
        client.subscribe(`usv/ally/${i}/commands`, { qos: 1 });
      }
      client.subscribe("usv/system/commands", { qos: 1 });

      // 지휘관 상태 토픽 구독 (MobRobGPT 스타일)
      client.subscribe("usv/commander/state", { qos: 1 });
    });

    client.on("error", (err) => {
      console.error("[DefenseMQTT] 오류:", err);
    });

    // 명령 수신 처리
    client.on("message", (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        const store = useDefenseStore.getState();

        // 아군 웨이포인트 수신 (ROS2 브릿지에서)
        if (topic.startsWith("usv/ally/") && topic.endsWith("/route")) {
          const match = topic.match(/usv\/ally\/(\d+)\/route/);
          if (match) {
            const allyId = parseInt(match[1], 10);
            const waypoints = data.waypoints || [];
            const netMask = data.net_mask || data.netMask || [];  // 그물 전개 구간

            // GPS 또는 SIM 좌표를 route로 변환
            const route = waypoints.map((wp: {
              x?: number;
              z?: number;
              lat?: number;
              lon?: number;
              paint?: boolean;
            }, idx: number) => {
              // paint 속성: wp.paint > netMask[idx] > false
              const paint = wp.paint ?? (netMask[idx] === true || netMask[idx] === 1) ?? false;

              if (wp.x !== undefined && wp.z !== undefined) {
                return { x: wp.x, z: wp.z, paint, started: false, active: true };
              } else if (wp.lat !== undefined && wp.lon !== undefined) {
                const sim = gpsToSim(wp.lat, wp.lon, motherLat, motherLon);
                return { x: sim.x, z: sim.z, paint, started: false, active: true };
              }
              return null;
            }).filter(Boolean);

            if (route.length > 0) {
              // 아군 현재 위치 확인
              const ally = store.allies.find(a => a.id === allyId);
              const allyPos = ally ? `(${ally.x.toFixed(2)}, ${ally.z.toFixed(2)})` : 'N/A';
              const first = route[0];

              // 첫 WP까지 거리 계산
              const distToFirst = ally ?
                Math.hypot(first.x - ally.x, first.z - ally.z).toFixed(2) : 'N/A';

              // 기존 경로와 비교 (좌표 변경 OR paint 플래그 변경)
              const prevRoute = ally?.route || [];
              const coordChanged = prevRoute.length !== route.length ||
                (prevRoute.length > 0 && route.length > 0 &&
                  (Math.abs(prevRoute[0].x - route[0].x) > 0.1 ||
                   Math.abs(prevRoute[0].z - route[0].z) > 0.1));
              // ★ paint 플래그 변경 감지 (그물 전개 명령)
              const paintChanged = prevRoute.length === route.length &&
                prevRoute.some((wp: { paint: boolean }, i: number) =>
                  wp.paint !== route[i]?.paint);
              const isNewRoute = coordChanged || paintChanged;

              // 경로 업데이트 (좌표 또는 paint 변경 시)
              if (isNewRoute) {
                store.setAllyRoute(allyId, route);
                const paintFlags = route.map((r: { paint: boolean }, i: number) =>
                  `WP${i}:${r.paint ? '🎨' : '○'}`
                ).join(' ');
                console.log(
                  `[DefenseMQTT] Ally ${allyId}: ★ 새 경로 ${route.length}개 WP ` +
                  `| 현재=${allyPos} → 첫WP=(${first.x.toFixed(2)}, ${first.z.toFixed(2)}) ` +
                  `| 거리=${distToFirst}m | ${paintFlags} | running=${store.running}`
                );
              }
            }
          }
        }

        // 시스템 명령
        if (topic === "usv/system/commands") {
          if (data.command === "start") {
            if (!store.running) store.toggleRunning();
          } else if (data.command === "stop") {
            if (store.running) store.toggleRunning();
          } else if (data.command === "reset") {
            store.reset();
          }
        }

        // 지휘관 상태 수신 (ROS2 브릿지에서)
        if (topic === "usv/commander/state") {
          store.setCommanderState({
            model: data.model || "oneway_ros2 (RL)",
            status: data.status || "ready",
            command: data.command || "모든 적군 포획",
            clusters: (data.clusters || []).map((c: {
              id: number;
              centroidX: number;
              centroidZ: number;
              enemyIds?: number[];
              enemyCount?: number;
              threat: number;
              bearing: number;
              color?: string;
            }) => ({
              id: c.id,
              centroidX: c.centroidX,
              centroidZ: c.centroidZ,
              enemyIds: c.enemyIds || [],
              threat: c.threat,
              spread: 0,
              bearing: c.bearing,
              color: c.color,
            })),
            assignments: data.assignments || [],
            rationale: data.rationale || "",
            lastUpdate: data.lastUpdate || 0,
          });
          console.log(`[DefenseMQTT] Commander state: ${data.clusters?.length || 0} clusters`);
        }

      } catch (e) {
        console.error("[DefenseMQTT] 메시지 파싱 오류:", e);
      }
    });

    // 텔레메트리 발행 타이머
    const publishInterval = setInterval(() => {
      if (!client.connected) return;

      const state = useDefenseStore.getState();
      const ts = Math.floor(Date.now() / 1000);

      // 아군 텔레메트리 (개별)
      state.allies.forEach((ally) => {
        const gps = simToGps(ally.x, ally.z, motherLat, motherLon);
        const telemetry = {
          id: ally.id,
          x: ally.x,
          z: ally.z,
          lat: gps.lat,
          lon: gps.lon,
          heading: ally.heading,
          speed: ally.speed,
          alive: ally.alive,
          netsRemaining: ally.netsRemaining,
          painting: ally.painting,
          ts,
        };
        client.publish(`usv/ally/${ally.id}/telemetry`, JSON.stringify(telemetry), { qos: 0 });
      });

      // 적군 텔레메트리 (개별)
      state.enemies.forEach((enemy) => {
        const gps = simToGps(enemy.x, enemy.z, motherLat, motherLon);
        const telemetry = {
          id: enemy.id,
          x: enemy.x,
          z: enemy.z,
          lat: gps.lat,
          lon: gps.lon,
          heading: enemy.heading,
          speed: enemy.speed,
          alive: enemy.alive,
          ts,
        };
        client.publish(`usv/enemy/${enemy.id}/telemetry`, JSON.stringify(telemetry), { qos: 0 });
      });

      // 전체 상태 (일괄) - 효율적인 전송
      // ★ netGrid를 압축 형태로 포함 (설치된 그물 셀 좌표 목록)
      const installedCells: [number, number][] = [];
      state.netGrid.forEach((row, i) => {
        row.forEach((cell, j) => {
          if (cell) installedCells.push([i, j]);
        });
      });

      const fullState = {
        allies: state.allies.map((a) => {
          const gps = simToGps(a.x, a.z, motherLat, motherLon);
          return { ...a, lat: gps.lat, lon: gps.lon };
        }),
        enemies: state.enemies.map((e) => {
          const gps = simToGps(e.x, e.z, motherLat, motherLon);
          return { ...e, lat: gps.lat, lon: gps.lon };
        }),
        mothership: {
          x: state.mothership.x,
          z: state.mothership.z,
          lat: motherLat,
          lon: motherLon,
        },
        netInstalled: installedCells,  // ★ 설치된 그물 셀 목록
        gridSize: state.netGrid.length,
        step: state.step,
        running: state.running,
        done: state.done,
        stats: state.stats,
        ts,
      };
      client.publish("usv/defense/state", JSON.stringify(fullState), { qos: 0 });

    }, config.telemetryIntervalMs);

    return () => {
      clearInterval(publishInterval);
      client.end(true);
      clientRef.current = null;
    };
  }, []);
}

/** 방어 모드 MQTT 상태 (디버그용) */
export function getDefenseMqttClient(): MqttClientType | null {
  return null; // 직접 접근 대신 훅 사용
}

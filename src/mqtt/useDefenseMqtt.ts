// ─────────────────────────────────────────────────────────────────────────
// 방어 시뮬레이터 MQTT 연동
// - 다중 선박 텔레메트리 발행 (아군 3대, 적군 10대, 모선)
// - ROS2 브릿지로부터 웨이포인트 명령 수신
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import mqtt from "mqtt";
import { config } from "../config";
import { useDefenseStore } from "../defenseStore";
import { DEFENSE_CONFIG as C } from "../config/defense";

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

    // 모선 GPS 기준점 (남해 매물도 - MobRobGPT와 일치)
    const motherLat = 34.625;
    const motherLon = 128.52;

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
              // 기존 경로와 비교하여 변경된 경우에만 업데이트
              const currentAlly = store.allies.find(a => a.id === allyId);
              const currentRoute = currentAlly?.route || [];

              // 좌표 변경 여부 확인 (0.1m 허용 오차)
              const isSameRoute = currentRoute.length === route.length &&
                route.every((wp: { x: number; z: number }, idx: number) => {
                  const cur = currentRoute[idx];
                  return cur &&
                    Math.abs(wp.x - cur.x) < 0.1 &&
                    Math.abs(wp.z - cur.z) < 0.1;
                });

              if (!isSameRoute) {
                // 경로가 변경됨 - 업데이트
                store.setAllyRoute(allyId, route);
                const paintCount = route.filter((r: { paint: boolean }) => r.paint).length;
                const first = route[0];
                const last = route[route.length - 1];
                console.log(
                  `[DefenseMQTT] Ally ${allyId}: ${route.length}개 WP 수신 (그물 ${paintCount}구간) ` +
                  `first=(${first.x.toFixed(2)}, ${first.z.toFixed(2)}) ` +
                  `last=(${last.x.toFixed(2)}, ${last.z.toFixed(2)})`
                );
              }
              // else: 경로 동일 - 스킵 (기존 진행 상태 유지)
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

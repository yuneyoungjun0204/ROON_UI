// ─────────────────────────────────────────────────────────────────────────
// 브릿지 모드 MQTT 연동
// - 외부에서 적군/아군 텔레메트리 수신
// - 시뮬레이션 없이 시각화만 담당
// - 명령 전달 (웨이포인트 등)
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import mqtt from "mqtt";
import { config } from "../config";
import { useDefenseStore } from "../defenseStore";
import { DEFENSE_CONFIG as C, GPS_ORIGIN } from "../config/defense";

type MqttClientType = ReturnType<typeof mqtt.connect>;

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

/** 브릿지 모드 MQTT 훅 */
export function useBridgeMqtt(): void {
  const clientRef = useRef<MqttClientType | null>(null);

  useEffect(() => {
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

    // 수신된 데이터 버퍼 (일괄 업데이트용)
    const allyBuffer = new Map<number, any>();
    const enemyBuffer = new Map<number, any>();
    let lastUpdateTime = 0;

    client.on("connect", () => {
      console.log("[BridgeMQTT] 연결됨 - 외부 데이터 구독 시작");

      // ★ 외부 텔레메트리 구독 (적군/아군)
      for (let i = 0; i < C.nAllies; i++) {
        client.subscribe(`usv/ally/${i}/telemetry`, { qos: 0 });
      }
      for (let i = 0; i < C.nEnemies; i++) {
        client.subscribe(`usv/enemy/${i}/telemetry`, { qos: 0 });
      }

      // 전체 상태 구독 (효율적)
      client.subscribe("usv/defense/state", { qos: 0 });

      // 명령 토픽 구독 (전달용)
      for (let i = 0; i < C.nAllies; i++) {
        client.subscribe(`usv/ally/${i}/route`, { qos: 1 });
      }
      client.subscribe("usv/system/commands", { qos: 1 });
      client.subscribe("usv/commander/state", { qos: 1 });

      console.log(`[BridgeMQTT] 구독 완료: ${C.nAllies}대 아군, ${C.nEnemies}대 적군`);
    });

    client.on("error", (err) => {
      console.error("[BridgeMQTT] 오류:", err);
    });

    // 메시지 수신 처리
    client.on("message", (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        const store = useDefenseStore.getState();

        // ★ 전체 상태 수신 (가장 효율적)
        if (topic === "usv/defense/state") {
          if (data.allies && data.enemies) {
            // 아군 데이터 변환
            const allies = data.allies.map((a: any) => {
              let x = a.x, z = a.z;
              if (a.lat !== undefined && a.lon !== undefined && (x === undefined || z === undefined)) {
                const sim = gpsToSim(a.lat, a.lon, motherLat, motherLon);
                x = sim.x;
                z = sim.z;
              }
              return {
                id: a.id,
                x, z,
                heading: a.heading || 0,
                speed: a.speed || 0,
                yawRate: a.yawRate || 0,
                thrustPort: a.thrustPort || 0,
                thrustStbd: a.thrustStbd || 0,
                throttle: a.throttle || 0,
                steer: a.steer || 0,
                alive: a.alive !== false,
                netsRemaining: a.netsRemaining ?? C.netsPerShip,
                painting: a.painting || false,
                paintDist: a.paintDist || 0,
                assignedCluster: a.assignedCluster ?? -1,
                route: a.route || [],
              };
            });

            // 적군 데이터 변환
            const enemies = data.enemies.map((e: any) => {
              let x = e.x, z = e.z;
              if (e.lat !== undefined && e.lon !== undefined && (x === undefined || z === undefined)) {
                const sim = gpsToSim(e.lat, e.lon, motherLat, motherLon);
                x = sim.x;
                z = sim.z;
              }
              return {
                id: e.id,
                x, z,
                heading: e.heading || 0,
                speed: e.speed || 0,
                alive: e.alive !== false,
                phase: e.phase || 0,
              };
            });

            // 그물 격자 복원 (netInstalled 배열에서)
            let netGrid = store.netGrid;
            if (data.netInstalled && Array.isArray(data.netInstalled)) {
              const gridSize = data.gridSize || C.gridSize;
              netGrid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(false));
              data.netInstalled.forEach(([i, j]: [number, number]) => {
                if (i >= 0 && i < gridSize && j >= 0 && j < gridSize) {
                  netGrid[i][j] = true;
                }
              });
            }

            // 상태 업데이트
            store.setExternalState({
              allies,
              enemies,
              netGrid,
              step: data.step || 0,
              running: data.running ?? true,
              done: data.done || false,
              stats: data.stats || store.stats,
            });
          }
          return;
        }

        // 개별 아군 텔레메트리 (폴백)
        if (topic.startsWith("usv/ally/") && topic.endsWith("/telemetry")) {
          const match = topic.match(/usv\/ally\/(\d+)\/telemetry/);
          if (match) {
            const id = parseInt(match[1], 10);
            let x = data.x, z = data.z;
            if (data.lat !== undefined && data.lon !== undefined) {
              const sim = gpsToSim(data.lat, data.lon, motherLat, motherLon);
              x = sim.x;
              z = sim.z;
            }
            allyBuffer.set(id, { ...data, x, z });
          }
        }

        // 개별 적군 텔레메트리 (폴백)
        if (topic.startsWith("usv/enemy/") && topic.endsWith("/telemetry")) {
          const match = topic.match(/usv\/enemy\/(\d+)\/telemetry/);
          if (match) {
            const id = parseInt(match[1], 10);
            let x = data.x, z = data.z;
            if (data.lat !== undefined && data.lon !== undefined) {
              const sim = gpsToSim(data.lat, data.lon, motherLat, motherLon);
              x = sim.x;
              z = sim.z;
            }
            enemyBuffer.set(id, { ...data, x, z });
          }
        }

        // 웨이포인트 명령 (전달)
        if (topic.startsWith("usv/ally/") && topic.endsWith("/route")) {
          const match = topic.match(/usv\/ally\/(\d+)\/route/);
          if (match) {
            const allyId = parseInt(match[1], 10);
            const waypoints = data.waypoints || [];
            const netMask = data.net_mask || data.netMask || [];

            const route = waypoints.map((wp: any, idx: number) => {
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
              store.setAllyRoute(allyId, route);
              console.log(`[BridgeMQTT] Ally ${allyId}: 경로 수신 ${route.length}개 WP`);
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

        // 지휘관 상태
        if (topic === "usv/commander/state") {
          store.setCommanderState({
            model: data.model || "external",
            status: data.status || "ready",
            command: data.command || "",
            clusters: (data.clusters || []).map((c: any) => ({
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
            lastUpdate: data.lastUpdate || Date.now(),
          });
        }

      } catch (e) {
        console.error("[BridgeMQTT] 메시지 파싱 오류:", e);
      }
    });

    // 개별 텔레메트리 버퍼 일괄 적용 (100ms마다)
    const bufferInterval = setInterval(() => {
      const now = Date.now();
      if (now - lastUpdateTime < 100) return;
      lastUpdateTime = now;

      if (allyBuffer.size > 0 || enemyBuffer.size > 0) {
        const store = useDefenseStore.getState();

        if (allyBuffer.size > 0) {
          const newAllies = store.allies.map((ally) => {
            const update = allyBuffer.get(ally.id);
            if (update) {
              return {
                ...ally,
                x: update.x,
                z: update.z,
                heading: update.heading ?? ally.heading,
                speed: update.speed ?? ally.speed,
                alive: update.alive !== false,
                netsRemaining: update.netsRemaining ?? ally.netsRemaining,
                painting: update.painting ?? ally.painting,
              };
            }
            return ally;
          });
          store.updateAllies(newAllies);
          allyBuffer.clear();
        }

        if (enemyBuffer.size > 0) {
          const newEnemies = store.enemies.map((enemy) => {
            const update = enemyBuffer.get(enemy.id);
            if (update) {
              return {
                ...enemy,
                x: update.x,
                z: update.z,
                heading: update.heading ?? enemy.heading,
                speed: update.speed ?? enemy.speed,
                alive: update.alive !== false,
              };
            }
            return enemy;
          });
          store.updateEnemies(newEnemies);
          enemyBuffer.clear();
        }
      }
    }, 100);

    return () => {
      clearInterval(bufferInterval);
      client.end(true);
      clientRef.current = null;
    };
  }, []);
}

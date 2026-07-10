// MQTT 연동 — 브로커(WebSocket)에 접속해
//  1) devices/<token>/telemetry 로 텔레메트리를 주기 발행하고
//  2) devices/<id>/commands 를 구독해 {channel, value} 명령을 시뮬레이션에 반영한다.
// 백엔드 워커의 스키마({sensor, value})에 맞춰 항목별로 쪼개 보낸다.

import { useEffect } from "react";
import mqtt from "mqtt";
import { config } from "../config";
import { useSimStore } from "../store";

const MS_TO_KN = 1.943844;

export function useMqtt(): void {
  useEffect(() => {
    const { setMqttStatus, setRudderCmd, setThrottle, setLastCommand } =
      useSimStore.getState();

    setMqttStatus("connecting");
    const client = mqtt.connect(config.mqttUrl, {
      username: config.mqttUsername || undefined,
      password: config.mqttPassword || undefined,
      reconnectPeriod: 3000,
      connectTimeout: 5000,
    });

    const commandTopic = `devices/${config.deviceId}/commands`;
    const telemetryTopic = `devices/${config.deviceToken}/telemetry`;

    client.on("connect", () => {
      setMqttStatus("connected");
      client.subscribe(commandTopic, { qos: 1 });
    });
    client.on("reconnect", () => setMqttStatus("connecting"));
    client.on("close", () => setMqttStatus("disconnected"));
    client.on("error", () => setMqttStatus("disconnected"));

    client.on("message", (topic, payload) => {
      if (topic !== commandTopic) return;
      try {
        const cmd = JSON.parse(payload.toString()) as {
          channel?: string;
          value?: unknown;
        };
        const value = Number(cmd.value);
        if (!Number.isFinite(value)) return;
        if (cmd.channel === "rudder") {
          setRudderCmd(value);
          setLastCommand(`rudder → ${value}°`);
        } else if (cmd.channel === "throttle") {
          setThrottle(value);
          setLastCommand(`throttle → ${value}%`);
        }
      } catch {
        // 형식이 다른 명령은 무시
      }
    });

    // 텔레메트리 주기 발행 (연결 안 되어 있으면 건너뜀)
    const timer = setInterval(() => {
      if (!client.connected) return;
      const { usv } = useSimStore.getState();
      const readings: Record<string, number> = {
        lat: usv.lat,
        lon: usv.lon,
        heading: usv.heading,
        sog: usv.speed * MS_TO_KN,
        rudder: usv.rudder,
      };
      const ts = Math.floor(Date.now() / 1000);
      for (const [sensor, value] of Object.entries(readings)) {
        client.publish(
          telemetryTopic,
          JSON.stringify({ sensor, value: Number(value.toFixed(6)), ts }),
          { qos: 1 },
        );
      }
    }, config.telemetryIntervalMs);

    return () => {
      clearInterval(timer);
      client.end(true);
    };
  }, []);
}

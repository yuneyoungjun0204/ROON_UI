// MQTT 연동 — 브로커(WebSocket)에 접속해
//  1) devices/<token>/telemetry 로 텔레메트리를 주기 발행하고 (transport=mqtt일 때만)
//  2) devices/<id>/commands 를 구독해 {channel, value} 명령을 시뮬레이션에 반영한다.
//
// "무엇을 보내고 무엇을 받는지"는 protocol.ts(collectReadings/applyCommand)에 있다.
// 이 파일은 그 값들을 MQTT 와이어에 실어 나르는 트랜스포트일 뿐이다.
//
// 명령(다운링크)은 브로커가 NAT 뒤 기기에 push해야 하므로 MQTT 전용이다.
// 그래서 transport=http여도, 명령을 받으려면(enableMqttCommands) 브로커에 접속한다.
// 순수 HTTP 센서로 쓰려면 VITE_ENABLE_MQTT_COMMANDS=false 로 브로커 접속을 끈다.

import { useEffect } from "react";
import mqtt from "mqtt";
import { config } from "../config";
import { useSimStore } from "../store";
import { collectReadings, applyCommand } from "../protocol";

export function useMqtt(): void {
  useEffect(() => {
    const publishesTelemetry = config.telemetryTransport === "mqtt";
    const subscribesCommands = config.enableMqttCommands;

    // MQTT로 할 일이 없으면(순수 HTTP 센서) 브로커에 접속하지 않는다.
    if (!publishesTelemetry && !subscribesCommands) return;

    const { setMqttStatus, setLastCommand } = useSimStore.getState();

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
      if (subscribesCommands) client.subscribe(commandTopic, { qos: 1 });
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
          [key: string]: unknown;
        };
        if (!cmd.channel) return;
        const desc = applyCommand(cmd.channel, cmd.value, cmd);
        if (desc) setLastCommand(desc);
      } catch {
        // 형식이 다른 명령은 무시
      }
    });

    // 텔레메트리 주기 발행 — 백엔드 워커 스키마에 맞춰 측정값을 항목별로 쪼개
    // 단건 {sensor, value, ts}로 보낸다(워커는 배열이 아닌 단건만 받는다).
    const timer = publishesTelemetry
      ? setInterval(() => {
          if (!client.connected) return;
          for (const r of collectReadings()) {
            client.publish(telemetryTopic, JSON.stringify(r), { qos: 1 });
          }
        }, config.telemetryIntervalMs)
      : undefined;

    return () => {
      if (timer) clearInterval(timer);
      client.end(true);
    };
  }, []);
}

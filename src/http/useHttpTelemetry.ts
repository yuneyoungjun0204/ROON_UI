// HTTP 텔레메트리 업링크 — 브로커 없이 백엔드에 측정값을 직접 POST한다.
//
//   POST <httpApiBase>/devices/telemetry
//   Authorization: Bearer <deviceToken>
//   본문: 측정값 배열  [{sensor, value, ts}, ...]   (단건도 원소 1개짜리 배열)
//   응답: 201 { accepted: <int> }
//
// MQTT 경로가 단건 발행인 것과 달리, HTTP 엔드포인트는 한 요청에 배치로 받는다.
// "무엇을 보내는지"는 protocol.ts(collectReadings)에 정의돼 있다.
// 업링크 전용이라 명령(다운링크)은 받지 않는다 — 명령이 필요하면 MQTT를 쓴다.

import { useEffect } from "react";
import { config } from "../config";
import { useSimStore } from "../store";
import { collectReadings } from "../protocol";

export function useHttpTelemetry(): void {
  useEffect(() => {
    if (config.telemetryTransport !== "http") return;

    const { setHttpStatus } = useSimStore.getState();
    const url = `${config.httpApiBase.replace(/\/$/, "")}/devices/telemetry`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deviceToken}`,
    };

    setHttpStatus("connecting");
    let aborted = false;

    async function send(): Promise<void> {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(collectReadings()),
        });
        if (aborted) return;
        setHttpStatus(res.ok ? "connected" : "disconnected");
      } catch {
        if (!aborted) setHttpStatus("disconnected");
      }
    }

    void send(); // 첫 발행은 주기를 기다리지 않고 즉시
    const timer = setInterval(() => void send(), config.telemetryIntervalMs);

    return () => {
      aborted = true;
      clearInterval(timer);
    };
  }, []);
}

// 미니맵 — 북쪽 고정(north-up), USV 중심의 2D 항적 지도.
// 캔버스를 rAF로 직접 그려서 리액트 리렌더 없이 갱신한다.

import { useEffect, useRef, useState } from "react";
import { Plus, Minus } from "lucide-react";
import { useSimStore, trail } from "../store";

const CSS_SIZE = 285; // px
const SCALES = [0.75, 1.5, 3, 6]; // m per px

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scaleIdx, setScaleIdx] = useState(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CSS_SIZE * dpr;
    canvas.height = CSS_SIZE * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scale = SCALES[scaleIdx]; // m/px
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { usv } = useSimStore.getState();
      const W = CSS_SIZE;
      const half = W / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = "#0a141e";
      ctx.fillRect(0, 0, W, W);

      // 월드 정렬 그리드
      const gridM = scale <= 1 ? 50 : scale <= 3 ? 100 : 250;
      ctx.strokeStyle = "rgba(125, 155, 180, 0.14)";
      ctx.lineWidth = 1;
      const viewM = half * scale;
      ctx.beginPath();
      for (
        let gx = Math.floor((usv.x - viewM) / gridM) * gridM;
        gx <= usv.x + viewM;
        gx += gridM
      ) {
        const px = half + (gx - usv.x) / scale;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, W);
      }
      for (
        let gz = Math.floor((usv.z - viewM) / gridM) * gridM;
        gz <= usv.z + viewM;
        gz += gridM
      ) {
        const pz = half + (gz - usv.z) / scale;
        ctx.moveTo(0, pz);
        ctx.lineTo(W, pz);
      }
      ctx.stroke();

      // 항적
      if (trail.length >= 4) {
        ctx.strokeStyle = "rgba(90, 190, 255, 0.75)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < trail.length; i += 2) {
          const px = half + (trail[i] - usv.x) / scale;
          const pz = half + (trail[i + 1] - usv.z) / scale;
          if (i === 0) ctx.moveTo(px, pz);
          else ctx.lineTo(px, pz);
        }
        ctx.lineTo(half, half);
        ctx.stroke();
      }

      // USV (침로 방향 삼각형) — 화면 위 = 북 = -z 이므로 heading 그대로 회전
      ctx.save();
      ctx.translate(half, half);
      ctx.rotate((usv.heading * Math.PI) / 180);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(4.5, 6);
      ctx.lineTo(-4.5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 북쪽 표시
      ctx.fillStyle = "rgba(200, 220, 235, 0.85)";
      ctx.font = "600 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("N", half, 12);

      // 축척 막대 (그리드 한 칸 = gridM)
      const barPx = gridM / scale;
      ctx.strokeStyle = "rgba(200, 220, 235, 0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(10, W - 10);
      ctx.lineTo(10 + barPx, W - 10);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillText(gridM >= 1000 ? `${gridM / 1000} km` : `${gridM} m`, 10, W - 15);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [scaleIdx]);

  return (
    <div className="panel minimap">
      <div className="minimap-head">
        <span className="label">MINIMAP</span>
        <div className="minimap-zoom">
          <button
            onClick={() => setScaleIdx((i) => Math.max(0, i - 1))}
            disabled={scaleIdx === 0}
            aria-label="확대"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={() => setScaleIdx((i) => Math.min(SCALES.length - 1, i + 1))}
            disabled={scaleIdx === SCALES.length - 1}
            aria-label="축소"
          >
            <Minus size={13} />
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: CSS_SIZE, height: CSS_SIZE, borderRadius: 8, display: "block" }}
      />
    </div>
  );
}

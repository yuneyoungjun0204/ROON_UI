// 파도 필드 — 방향성 사인파의 합.
// 바다 셰이더(GLSL)와 선박의 흔들림(JS)이 같은 파라미터를 공유해
// 배가 실제로 파도 위에 떠 있는 것처럼 보이게 한다.

export interface Wave {
  amplitude: number; // m
  wavelength: number; // m
  speed: number; // 위상 속도 계수
  dirX: number; // 진행 방향 (정규화)
  dirZ: number;
}

const norm = (x: number, z: number): [number, number] => {
  const l = Math.hypot(x, z);
  return [x / l, z / l];
};

const d1 = norm(1, 0.6);
const d2 = norm(-0.4, 1);
const d3 = norm(0.8, -0.5);
const d4 = norm(0.25, 1);

export const WAVES: Wave[] = [
  { amplitude: 0.5, wavelength: 140, speed: 0.7, dirX: d4[0], dirZ: d4[1] },
  { amplitude: 0.55, wavelength: 60, speed: 1.1, dirX: d1[0], dirZ: d1[1] },
  { amplitude: 0.3, wavelength: 27, speed: 1.6, dirX: d2[0], dirZ: d2[1] },
  { amplitude: 0.16, wavelength: 11, speed: 2.4, dirX: d3[0], dirZ: d3[1] },
];

/** 월드 좌표 (x, z)와 시각 t(초)의 해수면 높이(m) */
export function waveHeight(x: number, z: number, t: number): number {
  let y = 0;
  for (const w of WAVES) {
    const k = (Math.PI * 2) / w.wavelength;
    const phase = (w.dirX * x + w.dirZ * z) * k + t * w.speed;
    y += w.amplitude * Math.sin(phase);
  }
  return y;
}

/** GLSL 셰이더에 삽입할 파도 합산 코드 (waves.ts와 동일 파라미터) */
export function wavesGlsl(): string {
  const terms = WAVES.map((w) => {
    const k = ((Math.PI * 2) / w.wavelength).toFixed(6);
    return `y += ${w.amplitude.toFixed(4)} * sin((${w.dirX.toFixed(4)} * p.x + ${w.dirZ.toFixed(4)} * p.y) * ${k} + t * ${w.speed.toFixed(4)});`;
  });
  return `float waveHeight(vec2 p, float t) {\n  float y = 0.0;\n  ${terms.join("\n  ")}\n  return y;\n}`;
}

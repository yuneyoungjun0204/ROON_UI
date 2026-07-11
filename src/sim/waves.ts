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

/** 지오맵(호수) 모드의 수면 기준 높이(m).
 * DEM이 물가를 수면보다 살짝 높게 잡아 지형과 물 사이가 떠 보이는 문제를,
 * 수면 전체를 올려 물가 턱을 덮는 방식으로 해결한다.
 * 물 메시·배·카메라가 모두 이 값을 기준으로 뜬다. */
export const WATER_LEVEL_Y = 1.1;

// ── Gerstner 파도 (shipmulator 이식) ─────────────────────────────
// 긴 스웰 2개만 정점에서 변위(앨리어싱 방지), 짧은 잔물결은 수면 셰이더의
// 프래그먼트 노이즈 법선으로 처리한다. GPU 변위와 CPU 파고 샘플링(배 heave)이
// 같은 파라미터를 공유해 배가 실제 파도 위에 떠 있게 한다.

export interface GerstnerWave {
  dirX: number;
  dirZ: number;
  amplitude: number; // m
  wavelength: number; // m
  steepness: number;
}

const GERSTNER_G = 9.81;

/** 파도 속도 배율 (1 = 물리값). 낮출수록 느긋한 수면 */
export const WAVE_TIME_SCALE = 0.55;

// 잔잔한 챱(chop) — 큰 스웰 없이 낮고 짧은 물결 두 방향.
// 진폭이 작아 수면 격자를 성기게 잡아도 앨리어싱이 없다(성능 확보).
export const GERSTNER_WAVES: GerstnerWave[] = [
  { dirX: 1.0, dirZ: 0.3, amplitude: 0.14, wavelength: 60, steepness: 0.28 },
  { dirX: 0.5, dirZ: 0.85, amplitude: 0.1, wavelength: 34, steepness: 0.3 },
];

function gerstnerConstants(w: GerstnerWave) {
  const len = Math.hypot(w.dirX, w.dirZ);
  const dx = w.dirX / len;
  const dz = w.dirZ / len;
  const k = (2 * Math.PI) / w.wavelength;
  const c = Math.sqrt(GERSTNER_G / k) * WAVE_TIME_SCALE;
  const q = w.steepness / (k * w.amplitude * GERSTNER_WAVES.length);
  return { dx, dz, k, c, q };
}

/** CPU 파고 샘플링 (배 heave/자세 동기화) — 월드 (x, z), 시각 t(초) */
export function lakeWaveHeight(x: number, z: number, t: number): number {
  let y = 0;
  for (const w of GERSTNER_WAVES) {
    const { dx, dz, k, c } = gerstnerConstants(w);
    y += w.amplitude * Math.sin(k * (dx * x + dz * z) - k * c * t);
  }
  return y;
}

/** 수면 정점 셰이더에 삽입할 Gerstner 변위 + 법선 코드.
 * 사전조건: 스코프에 vec3 p(월드좌표), disp, nrm, float uTime 이 있어야 한다. */
export function buildGerstnerGLSL(): string {
  const f = (n: number) => n.toFixed(6);
  return GERSTNER_WAVES.map((w, i) => {
    const { dx, dz, k, c, q } = gerstnerConstants(w);
    return `
  { // gerstner ${i}
    vec2 D = vec2(${f(dx)}, ${f(dz)});
    float kk = ${f(k)};
    float A = ${f(w.amplitude)};
    float Q = ${f(q)};
    float ph = kk * (dot(D, p.xz) - ${f(c)} * uTime);
    float s = sin(ph);
    float co = cos(ph);
    disp.x += Q * A * D.x * co;
    disp.y += A * s;
    disp.z += Q * A * D.y * co;
    nrm.x -= D.x * kk * A * co;
    nrm.z -= D.y * kk * A * co;
    nrm.y -= Q * kk * A * s;
  }`;
  }).join("\n");
}

/** GLSL 셰이더에 삽입할 파도 합산 코드 (waves.ts와 동일 파라미터) */
export function wavesGlsl(): string {
  const terms = WAVES.map((w) => {
    const k = ((Math.PI * 2) / w.wavelength).toFixed(6);
    return `y += ${w.amplitude.toFixed(4)} * sin((${w.dirX.toFixed(4)} * p.x + ${w.dirZ.toFixed(4)} * p.y) * ${k} + t * ${w.speed.toFixed(4)});`;
  });
  return `float waveHeight(vec2 p, float t) {\n  float y = 0.0;\n  ${terms.join("\n  ")}\n  return y;\n}`;
}

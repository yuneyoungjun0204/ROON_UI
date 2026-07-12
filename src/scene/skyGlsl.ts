// 하늘 그라데이션 셰이더 조각 — 스카이돔과 수면 반사가 같은 함수를 공유해
// 물에 비친 하늘색·태양 광휘가 실제 하늘과 정확히 일치하게 한다.

import * as THREE from "three";

/** 맑고 청명한 날 팔레트 — 수평선은 거의 흰색, 위로 갈수록 옅은 하늘색 (밝고 투명한 느낌) */
export const SKY_PALETTE = {
  zenith: "#6b9fd4",
  mid: "#a6c6e6",
  horizon: "#eef4f9",
};

/** vec3 skyGradient(dir, zenith, mid, horizon, sunDir) — 방향에 따른 하늘색 + 태양 광휘 */
export const skyGradientGlsl = /* glsl */ `
vec3 skyGradient(vec3 dir, vec3 zenith, vec3 mid, vec3 horizon, vec3 sunDir) {
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.12, h));
  col = mix(col, zenith, smoothstep(0.12, 0.75, h));
  float sunAmt = max(dot(dir, sunDir), 0.0);
  col += vec3(1.0, 0.90, 0.72) * pow(sunAmt, 350.0) * 1.2; // 태양 주위 좁은 광휘
  col += vec3(1.0, 0.95, 0.85) * pow(sunAmt, 24.0) * 0.08; // 넓은 산란
  return col;
}
`;

export function createSkyColorUniforms() {
  return {
    uZenith: { value: new THREE.Color(SKY_PALETTE.zenith) },
    uMidSky: { value: new THREE.Color(SKY_PALETTE.mid) },
    uHorizonSky: { value: new THREE.Color(SKY_PALETTE.horizon) },
  };
}

/** 하늘 돔 재질 — 그라데이션 + 태양 원반 + FBM 구름 2겹(권운 베일 + 뭉게구름).
 * 스카이돔과 PMREM 환경맵 베이커가 같은 재질을 공유해
 * 배·지형이 반사/받는 빛이 눈에 보이는 하늘과 일치한다. */
export function makeSkyMaterial(sunDir: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      ...createSkyColorUniforms(),
      uSunDir: { value: sunDir.clone().normalize() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        // 카메라를 따라다니는 돔 — 회전만 반영하고 평행이동은 무시
        vec4 pos = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
        gl_Position = pos.xyww; // 깊이를 최원거리로 밀어 항상 배경이 되게
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uMidSky;
      uniform vec3 uHorizonSky;
      uniform vec3 uSunDir;
      uniform float uTime;
      varying vec3 vDir;
      ${skyGradientGlsl}

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y);
      }
      float fbm(vec2 p) {
        float s = 0.0; float a = 0.5;
        for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.13; a *= 0.5; }
        return s;
      }

      void main() {
        vec3 dir = normalize(vDir);
        vec3 color = skyGradient(dir, uZenith, uMidSky, uHorizonSky, uSunDir);

        // 또렷한 태양 원반
        float sunAmt = max(dot(dir, uSunDir), 0.0);
        color += vec3(1.0, 0.98, 0.90) * smoothstep(0.99965, 0.99985, sunAmt) * 2.5;

        // 구름 2겹 — 얇게 퍼진 권운 베일 + 부드러운 뭉게구름 몇 점
        if (dir.y > 0.01) {
          vec2 base = dir.xz / (dir.y + 0.22);

          vec2 cuv1 = base * vec2(0.16, 0.42) + vec2(uTime * 0.0025, uTime * 0.001);
          float w = fbm(cuv1);
          float veil = smoothstep(0.40, 0.80, w) * 0.42;

          vec2 cuv2 = base * 0.5 + vec2(uTime * 0.004, uTime * 0.0015);
          float f = fbm(cuv2);
          float band = smoothstep(0.02, 0.10, dir.y) * (1.0 - smoothstep(0.55, 0.95, dir.y));
          float puff = smoothstep(0.56, 0.78, f) * band;

          float cloud = clamp(veil * (0.5 + 0.5 * band) + puff, 0.0, 1.0);
          vec3 cloudCol = mix(vec3(0.93, 0.95, 0.97), vec3(1.0), smoothstep(0.55, 0.82, max(f, w)));
          color = mix(color, cloudCol, cloud * 0.88);
        }

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

// 항적 거품 — 속도에 비례해 선미(+선수 물보라)에 흰 거품 입자를 뿌린다.
// 입자는 그 자리에 남아 파도 위에 떠서 커지며 사라진다 → 배가 "지나온 길"이 보여 속도감을 만든다.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { waveHeight } from "../sim/waves";
import { useSimStore } from "../store";

const COUNT = 1200;

const vertexShader = /* glsl */ `
attribute float aBirth;
attribute float aLife;
attribute float aSize;
uniform float uTime;
varying float vAlpha;

void main() {
  float age = uTime - aBirth;
  float k = clamp(age / max(aLife, 0.001), 0.0, 1.0);
  vAlpha = (1.0 - k) * (1.0 - k) * 0.9;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float grow = 1.0 + k * 2.6;
  gl_PointSize = aSize * grow * (260.0 / max(-mv.z, 1.0));
  if (age < 0.0 || age > aLife) gl_PointSize = 0.0;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.92, 0.97, 1.0, a);
}
`;

export function Wake() {
  const geoRef = useRef<THREE.BufferGeometry>(null);

  const data = useMemo(
    () => ({
      positions: new Float32Array(COUNT * 3),
      birth: new Float32Array(COUNT).fill(-1000),
      life: new Float32Array(COUNT).fill(1),
      size: new Float32Array(COUNT).fill(1),
      next: 0,
      spawnAcc: 0,
    }),
    [],
  );

  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  useFrame(({ clock }, dt) => {
    const geo = geoRef.current;
    if (!geo) return;
    const t = clock.elapsedTime;
    uniforms.uTime.value = t;

    const { usv } = useSimStore.getState();
    const speed = Math.abs(usv.speed);
    const rad = (usv.heading * Math.PI) / 180;
    const fwd = { x: Math.sin(rad), z: -Math.cos(rad) };
    const stb = { x: -fwd.z, z: fwd.x };

    // 속도에 비례해 스폰 (약 10개/초 @ 1 m/s — 풀 크기와 수명에 맞춘 상한)
    data.spawnAcc += speed * 10 * dt;
    const { positions, birth, life, size } = data;
    while (data.spawnAcc >= 1) {
      data.spawnAcc -= 1;
      const i = data.next;
      data.next = (i + 1) % COUNT;
      let px: number;
      let pz: number;
      if (Math.random() < 0.72) {
        // 선미 프로펠러 후류 — 두 데미헐 각각에서 뿜는다
        const side = Math.random() < 0.5 ? 1 : -1;
        const lat = side * 2.35 + (Math.random() - 0.5) * 1.2;
        px = usv.x - fwd.x * 7.4 + stb.x * lat;
        pz = usv.z - fwd.z * 7.4 + stb.z * lat;
        size[i] = 1.6 + Math.random() * 2.0;
      } else {
        // 선수 양현 물보라
        const side = Math.random() < 0.5 ? 1 : -1;
        px = usv.x + fwd.x * 5.4 + stb.x * side * (2.4 + Math.random() * 0.6);
        pz = usv.z + fwd.z * 5.4 + stb.z * side * (2.4 + Math.random() * 0.6);
        size[i] = 0.6 + Math.random() * 0.8;
      }
      positions[i * 3] = px;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = pz;
      birth[i] = t;
      life[i] = 3.5 + Math.random() * 4.5;
    }

    // 살아 있는 입자를 해수면 높이에 얹는다
    for (let i = 0; i < COUNT; i++) {
      if (t - birth[i] <= life[i]) {
        positions[i * 3 + 1] = waveHeight(positions[i * 3], positions[i * 3 + 2], t) + 0.06;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aBirth.needsUpdate = true;
    geo.attributes.aLife.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
        <bufferAttribute attach="attributes-aBirth" args={[data.birth, 1]} />
        <bufferAttribute attach="attributes-aLife" args={[data.life, 1]} />
        <bufferAttribute attach="attributes-aSize" args={[data.size, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </points>
  );
}

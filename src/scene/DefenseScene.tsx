// ─────────────────────────────────────────────────────────────────────────
// 방어 시뮬레이터 3D 씬
// - 10대 적군 (빨간색), 3대 아군 (파란색), 1대 모선
// - 그물 시각화
// - FollowCam: u1-u3 (아군), a1-a10 (적군)
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Sky } from "@react-three/drei";
import * as THREE from "three";
import { useDefenseStore, startDefenseLoop } from "../defenseStore";
import { DEFENSE_CONFIG as C } from "../config/defense";
import { Mothership } from "./Mothership";
import { NetMesh } from "./NetMesh";
import type { ShipState } from "../types/defense";
import { wavesGlsl } from "../sim/waves";

// ─────────────────────────────────────────────────────────────────────────
// 카메라 모드 전역 상태
// ─────────────────────────────────────────────────────────────────────────
type CameraMode =
  | { type: "tactical" }
  | { type: "followAlly"; id: number }
  | { type: "followEnemy"; id: number };

let cameraMode: CameraMode = { type: "tactical" };
const cameraModeListeners: Set<() => void> = new Set();

function setCameraMode(mode: CameraMode) {
  cameraMode = mode;
  cameraModeListeners.forEach((fn) => fn());
}

function useCameraMode() {
  const [, forceUpdate] = useState({});
  useEffect(() => {
    const listener = () => forceUpdate({});
    cameraModeListeners.add(listener);
    return () => { cameraModeListeners.delete(listener); };
  }, []);
  return cameraMode;
}

// 키보드 입력 처리
if (typeof window !== "undefined") {
  let inputBuffer = "";
  let inputTimeout: ReturnType<typeof setTimeout> | null = null;

  window.addEventListener("keydown", (e) => {
    // 입력창에 포커스되어 있으면 무시
    if (document.activeElement?.tagName === "INPUT") return;

    const key = e.key.toLowerCase();

    // ESC로 전술 뷰로 복귀
    if (key === "escape" || key === "t") {
      setCameraMode({ type: "tactical" });
      inputBuffer = "";
      return;
    }

    // 숫자나 u/a 입력
    if (/^[ua0-9]$/.test(key)) {
      inputBuffer += key;

      if (inputTimeout) clearTimeout(inputTimeout);
      inputTimeout = setTimeout(() => {
        inputBuffer = "";
      }, 1000);

      // u1, u2, u3 - 아군
      const allyMatch = inputBuffer.match(/u([1-3])$/);
      if (allyMatch) {
        setCameraMode({ type: "followAlly", id: parseInt(allyMatch[1]) - 1 });
        inputBuffer = "";
        return;
      }

      // a1-a10 - 적군
      const enemyMatch = inputBuffer.match(/a(10|[1-9])$/);
      if (enemyMatch) {
        setCameraMode({ type: "followEnemy", id: parseInt(enemyMatch[1]) - 1 });
        inputBuffer = "";
        return;
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 카메라 컨트롤러
// ─────────────────────────────────────────────────────────────────────────

function CameraController() {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const mode = useCameraMode();
  const offset = C.worldSize / 2;
  const target = useMemo(() => new THREE.Vector3(), []);

  // 스케일에 맞춘 카메라 거리
  const tacticalHeight = C.worldSize * 0.8;
  const tacticalDist = C.worldSize * 0.6;

  useEffect(() => {
    if (mode.type === "tactical") {
      camera.position.set(0, tacticalHeight, tacticalDist);
      camera.lookAt(0, 0, 0);
    }
  }, [mode, camera, tacticalHeight, tacticalDist]);

  useFrame(() => {
    const state = useDefenseStore.getState();

    if (mode.type === "tactical") {
      return; // OrbitControls가 처리
    }

    let ship: ShipState | undefined;

    if (mode.type === "followAlly") {
      ship = state.allies[mode.id];
    } else if (mode.type === "followEnemy") {
      ship = state.enemies[mode.id];
    }

    if (!ship || !ship.alive) {
      setCameraMode({ type: "tactical" });
      return;
    }

    const sceneX = ship.x - offset;
    const sceneZ = ship.z - offset;
    const yaw = (ship.heading * Math.PI) / 180;

    // 선박 뒤쪽에서 따라가는 카메라 (스케일 적용)
    const camDist = C.render.shipLength * 1.5;
    const camHeight = C.render.shipLength * 0.5;

    target.set(sceneX, C.render.shipHeight, sceneZ);

    camera.position.set(
      sceneX - Math.sin(yaw) * camDist,
      camHeight,
      sceneZ + Math.cos(yaw) * camDist
    );
    camera.lookAt(target);

    if (controlsRef.current) {
      controlsRef.current.target.copy(target);
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={mode.type === "tactical"}
      maxPolarAngle={Math.PI / 2.1}
      minDistance={C.worldSize * 0.01}
      maxDistance={C.worldSize * 2}
      enablePan={true}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 바다 (원본 색상과 동일)
// ─────────────────────────────────────────────────────────────────────────

const OCEAN_SIZE = C.worldSize * 1.5;
const OCEAN_SEGMENTS = 150;

const oceanVertexShader = /* glsl */ `
uniform float uTime;
uniform float uScale;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vWaveH;

${"__WAVES__"}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h = waveHeight(wp.xz, uTime);
  wp.y += h;
  vWaveH = h;

  float e = 1.2 * uScale;
  float hx = waveHeight(wp.xz + vec2(e, 0.0), uTime);
  float hz = waveHeight(wp.xz + vec2(0.0, e), uTime);
  vNormal = normalize(vec3(h - hx, e, h - hz));
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const oceanFragmentShader = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform vec3 uSunDir;
uniform vec3 uDeepColor;
uniform vec3 uSeaColor;
uniform vec3 uSkyColor;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vWaveH;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float detailH(vec2 p, float t, float scale) {
  // 스케일에 맞게 노이즈 주파수 조정 (역스케일 적용)
  float invScale = 1.0 / scale;
  float h = 0.0;
  h += vnoise(p * 0.35 * invScale + vec2(t * 0.20, t * 0.13)) * 0.60;
  h += vnoise(p * 0.95 * invScale - vec2(t * 0.26, t * 0.17)) * 0.30;
  h += vnoise(p * 2.30 * invScale + vec2(t * 0.34, -t * 0.23)) * 0.12;
  return h * scale;
}

void main() {
  vec2 wp = vWorldPos.xz;

  float camDist = length(cameraPosition - vWorldPos);
  float detailAmp = 0.8 * (1.0 - smoothstep(60.0 * uScale, 900.0 * uScale, camDist));
  float e = 0.45 * uScale;
  float h0 = detailH(wp, uTime, uScale);
  float hx = detailH(wp + vec2(e, 0.0), uTime, uScale);
  float hz = detailH(wp + vec2(0.0, e), uTime, uScale);
  vec3 n = normalize(vNormal + vec3((h0 - hx) * detailAmp, 0.0, (h0 - hz) * detailAmp));

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float facing = max(dot(n, viewDir), 0.0);

  vec3 base = mix(uSeaColor, uDeepColor, facing);
  float fresnel = pow(1.0 - facing, 3.0);
  vec3 color = mix(base, uSkyColor, fresnel * 0.85);

  float sunBehind = max(dot(viewDir, -uSunDir), 0.0);
  color += vec3(0.02, 0.12, 0.11) * sunBehind * smoothstep(0.1 * uScale, 1.1 * uScale, vWaveH);

  vec3 halfDir = normalize(uSunDir + viewDir);
  float ndh = max(dot(n, halfDir), 0.0);
  color += vec3(1.0, 0.96, 0.82) * (pow(ndh, 260.0) * 1.2 + pow(ndh, 36.0) * 0.12);

  float crest = smoothstep(0.55 * uScale, 1.15 * uScale, vWaveH + (h0 - 0.5 * uScale) * 0.9);
  color = mix(color, vec3(0.90, 0.95, 0.97), crest * 0.30);

  gl_FragColor = vec4(color, 1.0);
}
`;

function DefenseOcean() {
  const meshRef = useRef<THREE.Mesh>(null);
  const sunDir = useMemo(() => new THREE.Vector3(50, 62, -38), []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uScale: { value: C.scale },
      uSunDir: { value: sunDir.clone().normalize() },
      uDeepColor: { value: new THREE.Color("#07304a") },
      uSeaColor: { value: new THREE.Color("#155e74") },
      uSkyColor: { value: new THREE.Color("#9dccec") },
    }),
    [sunDir],
  );

  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <mesh ref={meshRef} rotation-x={-Math.PI / 2} position={[0, 0, 0]} frustumCulled={false}>
      <planeGeometry args={[OCEAN_SIZE, OCEAN_SIZE, OCEAN_SEGMENTS, OCEAN_SEGMENTS]} />
      <shaderMaterial
        vertexShader={oceanVertexShader.replace("__WAVES__", wavesGlsl())}
        fragmentShader={oceanFragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 전술 선박
// ─────────────────────────────────────────────────────────────────────────

function TacticalShip({ state, team, selected }: {
  state: ShipState;
  team: "ally" | "enemy";
  selected?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const offset = C.worldSize / 2;

  const isAlly = team === "ally";
  const primaryColor = isAlly ? 0x2266ff : 0xff2222;
  const markerColor = isAlly ? 0x00aaff : 0xff4444;

  // 스케일된 렌더링 값
  const { shipLength, shipWidth, shipHeight, markerHeight, markerSphere } = C.render;

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;

    g.visible = state.alive;
    if (!state.alive) return;

    g.position.set(state.x - offset, 0, state.z - offset);
    g.rotation.y = -(state.heading * Math.PI) / 180;
  });

  if (!state.alive) return null;

  return (
    <group ref={groupRef}>
      {/* 선체 */}
      <mesh position={[0, shipHeight / 2, 0]} castShadow>
        <boxGeometry args={[shipWidth, shipHeight, shipLength]} />
        <meshStandardMaterial color={primaryColor} />
      </mesh>

      {/* 선수 */}
      <mesh position={[0, shipHeight / 2, -shipLength * 0.56]} castShadow>
        <coneGeometry args={[shipWidth / 2, shipLength * 0.3, 4]} />
        <meshStandardMaterial color={primaryColor} />
      </mesh>

      {/* 브릿지 */}
      <mesh position={[0, shipHeight * 1.5, shipLength * 0.12]} castShadow>
        <boxGeometry args={[shipWidth * 0.66, shipHeight * 1.3, shipLength * 0.3]} />
        <meshStandardMaterial color={0xeeeeee} />
      </mesh>

      {/* 마커 폴 */}
      <mesh position={[0, markerHeight / 2, 0]}>
        <cylinderGeometry args={[markerSphere * 0.15, markerSphere * 0.15, markerHeight, 8]} />
        <meshBasicMaterial color={markerColor} />
      </mesh>

      {/* 상단 구체 */}
      <mesh position={[0, markerHeight + markerSphere * 0.5, 0]}>
        <sphereGeometry args={[markerSphere]} />
        <meshBasicMaterial color={markerColor} />
      </mesh>

      {/* 선택 링 */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
          <ringGeometry args={[shipLength * 0.7, shipLength * 0.85, 32]} />
          <meshBasicMaterial color={0x00ff00} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 조명, 클러스터
// ─────────────────────────────────────────────────────────────────────────

function Lighting() {
  const shadowRange = C.worldSize * 1.5;
  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight
        position={[50, 62, -38]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={shadowRange * 2}
        shadow-camera-left={-shadowRange}
        shadow-camera-right={shadowRange}
        shadow-camera-top={shadowRange}
        shadow-camera-bottom={-shadowRange}
      />
      <hemisphereLight args={[0xcfe6f8, 0x3a5f6e, 0.5]} />
    </>
  );
}

function ClusterOverlay() {
  const clusters = useDefenseStore((s) => s.clusters);
  const offset = C.worldSize / 2;
  const minRingSize = C.render.shipLength * 2;

  return (
    <group>
      {clusters.map((cluster) => (
        <group
          key={cluster.id}
          position={[cluster.centroidX - offset, C.render.shipHeight * 2, cluster.centroidZ - offset]}
        >
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[
              Math.max(minRingSize, cluster.spread * 0.8),
              Math.max(minRingSize * 1.2, cluster.spread),
              32
            ]} />
            <meshBasicMaterial
              color={[0xff4444, 0xff8800, 0xffff00, 0xff44ff][cluster.id % 4]}
              transparent
              opacity={0.3}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 경로 연결선 (THREE.Line 사용)
// ─────────────────────────────────────────────────────────────────────────

function RouteLine({ points, color }: { points: THREE.Vector3[]; color: number }) {
  const lineObj = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      linewidth: 3,
      transparent: true,
      opacity: 0.6,
    });
    return new THREE.Line(geometry, material);
  }, [points, color]);

  return <primitive object={lineObj} />;
}

// ─────────────────────────────────────────────────────────────────────────
// 웨이포인트 마커
// ─────────────────────────────────────────────────────────────────────────

function WaypointMarkers() {
  const allies = useDefenseStore((s) => s.allies);
  const offset = C.worldSize / 2;
  // 마커 크기를 더 키움 (선박 길이의 1.5배)
  const wpSize = C.render.shipLength * 1.5;

  // 아군별 색상 (더 밝은 색으로)
  const allyColors = [0xff6666, 0xffaa66, 0xffcc66];  // 밝은 빨강, 주황, 노랑

  return (
    <group name="waypoints">
      {allies.map((ally) => {
        const color = allyColors[ally.id % allyColors.length];
        const routePoints: THREE.Vector3[] = [];

        // 경로 포인트 수집 (연결선용)
        ally.route.forEach((wp) => {
          routePoints.push(new THREE.Vector3(wp.x - offset, wpSize * 0.5, wp.z - offset));
        });

        return (
          <group key={`ally-wps-${ally.id}`}>
            {/* 경로 연결선 */}
            {routePoints.length > 1 && (
              <RouteLine points={routePoints} color={color} />
            )}

            {/* 웨이포인트 마커 */}
            {ally.route.map((wp, wpIdx) => {
              const sceneX = wp.x - offset;
              const sceneZ = wp.z - offset;
              const isNetWp = wp.paint;

              return (
                <group key={`wp-${ally.id}-${wpIdx}`} position={[sceneX, wpSize, sceneZ]}>
                  {/* WP 구체 */}
                  <mesh>
                    <sphereGeometry args={[wpSize * 0.5, 16, 16]} />
                    <meshBasicMaterial
                      color={color}
                      transparent
                      opacity={0.9}
                    />
                  </mesh>

                  {/* 그물 WP는 큰 링으로 강조 */}
                  {isNetWp && (
                    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
                      <ringGeometry args={[wpSize * 0.7, wpSize, 16]} />
                      <meshBasicMaterial color={0x00ff44} transparent opacity={0.8} side={THREE.DoubleSide} />
                    </mesh>
                  )}

                  {/* 지면 투영 링 */}
                  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -wpSize + 0.05, 0]}>
                    <ringGeometry args={[wpSize * 0.3, wpSize * 0.5, 16]} />
                    <meshBasicMaterial color={color} transparent opacity={0.4} side={THREE.DoubleSide} />
                  </mesh>

                  {/* WP 인덱스 폴 + 번호 */}
                  <mesh position={[0, wpSize, 0]}>
                    <cylinderGeometry args={[wpSize * 0.05, wpSize * 0.05, wpSize * 1.5, 8]} />
                    <meshBasicMaterial color={color} />
                  </mesh>
                  <mesh position={[0, wpSize * 1.8, 0]}>
                    <sphereGeometry args={[wpSize * 0.25]} />
                    <meshBasicMaterial color={wpIdx === 0 ? 0xffffff : color} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 메인 씬
// ─────────────────────────────────────────────────────────────────────────

function DefenseSceneContent() {
  const allies = useDefenseStore((s) => s.allies);
  const enemies = useDefenseStore((s) => s.enemies);
  const mothership = useDefenseStore((s) => s.mothership);
  const selectedAlly = useDefenseStore((s) => s.selectedAlly);

  return (
    <>
      <CameraController />
      <Lighting />
      <Sky sunPosition={[50, 62, -38]} />
      <fog attach="fog" args={[0x9dccec, C.worldSize * 0.5, C.worldSize * 3]} />

      {/* 바다 (원본 색상) */}
      <DefenseOcean />

      {/* 모선 */}
      <Mothership state={mothership} />

      {/* 아군 (3대) - 파란색 */}
      {allies.map((ally) => (
        <TacticalShip
          key={`ally-${ally.id}`}
          state={ally}
          team="ally"
          selected={ally.id === selectedAlly}
        />
      ))}

      {/* 적 (10대) - 빨간색 */}
      {enemies.map((enemy) => (
        <TacticalShip
          key={`enemy-${enemy.id}`}
          state={enemy}
          team="enemy"
        />
      ))}

      {/* 그물 */}
      <NetMesh />

      {/* 웨이포인트 마커 */}
      <WaypointMarkers />

      {/* 클러스터 표시 */}
      <ClusterOverlay />
    </>
  );
}

export function DefenseScene() {
  useEffect(() => {
    const cleanup = startDefenseLoop();
    return cleanup;
  }, []);

  return (
    <Canvas
      shadows
      camera={{ fov: 55, near: C.worldSize * 0.001, far: C.worldSize * 5 }}
      gl={{ antialias: true }}
    >
      <DefenseSceneContent />
    </Canvas>
  );
}

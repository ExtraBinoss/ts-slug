<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  SlugGeometry,
  SlugGenerator,
  SlugMaterial,
  injectSlug,
  type SlugGeneratedData,
  type SlugGlyphStyle,
  type SlugShaderEffect,
  type SlugLoaderData,
} from "../library";

type TabId = "playground" | "benchmark" | "effects";
type CameraMode = "2d" | "orbit";
type MaterialMode = "slug" | "standard";

type RenderSlugData = SlugLoaderData | SlugGeneratedData;

type SceneMeshSpec = {
  text: string;
  x: number;
  y: number;
  fontScale: number;
  lineHeightFactor?: number;
  maxWidth?: number;
  wrap?: boolean;
  wrapMode?: "word" | "char";
  color?: [number, number, number, number];
  params?: [number, number, number, number];
  styleResolver?: (
    codePoint: number,
    lineIndex: number,
    glyphIndex: number,
    line: string,
  ) => SlugGlyphStyle | null | undefined;
  effects?: SlugShaderEffect[];
  useStandard?: boolean;
  scale?: number;
  shadow?: { offsetX: number; offsetY: number; scale: number; opacity: number };
};

const host = ref<HTMLDivElement | null>(null);
const status = ref("Initializing renderer...");
const inputText = ref("TS Slug\nTypeScript Port");
const fontScale = ref(0.14);
const lineSpacing = ref(1.15);
const cameraMode = ref<CameraMode>("2d");
const activeTab = ref<TabId>("playground");
const materialMode = ref<MaterialMode>("slug");
const backgroundColor = ref("#e9edf2");
const usePageBackground = ref(false);
const selectedFont = ref("SpaceMono-Regular.ttf");
const availableFonts = ref<string[]>([]);
const renderInfo = ref({
  calls: 0,
  triangles: 0,
  lines: 0,
  points: 0,
  geometries: 0,
  textures: 0,
});

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null = null;
let controls: OrbitControls | null = null;
let resizeObserver: ResizeObserver | null = null;
let animationFrame = 0;
let loadedSlugData: RenderSlugData | null = null;
let loadTicket = 0;
let frameCounter = 0;
let sceneRoot: THREE.Group | null = null;
const slugGenerator = new SlugGenerator({ fullRange: true });
const generatedCache = new Map<string, RenderSlugData>();

function applySceneBackground(): void {
  if (!scene || !renderer) return;

  if (usePageBackground.value) {
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    return;
  }

  scene.background = new THREE.Color(backgroundColor.value);
  renderer.setClearColor(backgroundColor.value, 1);
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createWaveEffect(
  name: string,
  phase: number,
  frequency: number,
  amplitude: number,
): SlugShaderEffect {
  return {
    name,
    uniforms: {
      uWavePhase: { value: phase },
      uWaveFrequency: { value: frequency },
      uWaveAmplitude: { value: amplitude },
    },
    vertex: `
      float slugWaveSeed = aScaleBias.z * 0.03 + aScaleBias.w * 0.017;
      transformed.y += sin(slugWaveSeed + uSlugTime * max(uWaveFrequency, 0.0001) + uWavePhase) * uWaveAmplitude;
    `,
  };
}

function createRainbowEffect(
  name: string,
  mix: number,
  phase: number,
): SlugShaderEffect {
  return {
    name,
    uniforms: {
      uRainbowMix: { value: mix },
      uRainbowPhase: { value: phase },
    },
    fragment: `
      vec3 slugRainbow = rainbowColor(vGlyphInstance * 0.07 + uSlugTime * 0.25 + uRainbowPhase + vGlyphParams.x);
      diffuseColor.rgb = mix(diffuseColor.rgb, slugRainbow, clamp(uRainbowMix, 0.0, 1.0));
    `,
  };
}

function createPulseEffect(
  name: string,
  strength: number,
  phase: number,
): SlugShaderEffect {
  return {
    name,
    uniforms: {
      uPulseStrength: { value: strength },
      uPulsePhase: { value: phase },
    },
    fragment: `
      float slugPulse = 0.5 + 0.5 * sin(uPulsePhase + uSlugTime * 2.0 + vGlyphInstance * 0.05 + vGlyphParams.x * 0.02);
      diffuseColor.rgb *= 1.0 + slugPulse * uPulseStrength;
      diffuseColor.a *= 1.0 + 0.15 * slugPulse * uPulseStrength;
    `,
  };
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) material.dispose();
    } else if (mesh.material) {
      mesh.material.dispose();
    }
  });
}

function clearScene(): void {
  const currentScene = scene;
  if (!currentScene) return;
  if (sceneRoot) {
    currentScene.remove(sceneRoot);
    disposeObject(sceneRoot);
  }
  sceneRoot = new THREE.Group();
  currentScene.add(sceneRoot);
}

function addToScene(object: THREE.Object3D): void {
  if (sceneRoot) sceneRoot.add(object);
}

function disposeCurrentScene(): void {
  if (!sceneRoot || !scene) return;
  scene.remove(sceneRoot);
  disposeObject(sceneRoot);
  sceneRoot = null;
}

function resize(): void {
  if (!host.value || !renderer || !camera) return;
  const { width, height } = host.value.getBoundingClientRect();
  if (width <= 0 || height <= 0) return;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);

  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = width / height;
  } else {
    const orthoCamera = camera as THREE.OrthographicCamera;
    const frustumHeight = 1000;
    const halfH = frustumHeight / 2;
    const halfW = halfH * (width / height);
    orthoCamera.left = -halfW;
    orthoCamera.right = halfW;
    orthoCamera.top = halfH;
    orthoCamera.bottom = -halfH;
  }

  camera.updateProjectionMatrix();
}

function setupCameraAndControls(): void {
  if (!host.value || !renderer || !scene) return;

  controls?.dispose();
  controls = null;

  if (cameraMode.value === "orbit") {
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 12000);
    camera.position.set(0, 0, 1400);
  } else {
    camera = new THREE.OrthographicCamera(-500, 500, 500, -500, -5000, 5000);
    camera.position.set(0, 0, 1200);
  }

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.target.set(0, 0, 0);

  if (cameraMode.value === "orbit") {
    controls.enableRotate = true;
    controls.minDistance = 50;
    controls.maxDistance = 10000;
  } else {
    controls.enableRotate = false;
    controls.minZoom = 0.2;
    controls.maxZoom = 20;
    controls.zoomSpeed = 1.2;
  }

  controls.update();
  resize();
}

function getGlyphData(char: string) {
  if (!loadedSlugData) return null;
  const codePoint = char.codePointAt(0) ?? 0;
  return (
    loadedSlugData.codePoints.get(codePoint) ||
    loadedSlugData.codePoints.get(-1) ||
    null
  );
}

function buildMaterial(
  useStandard?: boolean,
  effects: SlugShaderEffect[] = [],
): THREE.Material {
  if (!loadedSlugData) {
    return new THREE.MeshBasicMaterial({ color: 0xffffff });
  }

  const shouldUseStandard =
    effects.length > 0 || (useStandard ?? materialMode.value === "standard");

  if (shouldUseStandard) {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffd37a,
      roughness: 0.45,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });
    injectSlug(material, loadedSlugData, { effects });
    return material;
  }

  return new SlugMaterial({
    curvesTex: loadedSlugData.curvesTex,
    bandsTex: loadedSlugData.bandsTex,
  });
}

function buildTextMesh(spec: SceneMeshSpec): THREE.Mesh | null {
  if (!loadedSlugData) return null;

  const glyphCapacity = Math.max(256, spec.text.length * 4);
  const geometry = new SlugGeometry(glyphCapacity);

  const baseLineHeight =
    loadedSlugData.unitsPerEm > 0
      ? loadedSlugData.ascender -
        loadedSlugData.descender +
        loadedSlugData.lineGap
      : 2000;

  geometry.addText(spec.text, loadedSlugData, {
    fontScale: spec.fontScale,
    lineHeight:
      baseLineHeight *
      (spec.lineHeightFactor ?? lineSpacing.value) *
      spec.fontScale,
    startX: 0,
    startY: 0,
    justify: "left",
    maxWidth: spec.maxWidth,
    wrap: spec.wrap,
    wrapMode: spec.wrapMode,
    glyphStyle:
      spec.styleResolver ||
      (spec.color || spec.params
        ? {
            color: spec.color || [1, 1, 1, 1],
            params: spec.params || [0, 0, 0, 0],
          }
        : undefined),
  });

  const material = buildMaterial(spec.useStandard, spec.effects);
  const mesh = new THREE.Mesh(geometry, material);
  if (spec.scale !== undefined) mesh.scale.setScalar(spec.scale);
  mesh.position.set(spec.x, spec.y, 0);

  const box = geometry.boundingBox;
  if (box && !box.isEmpty()) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    mesh.position.x += -center.x;
    mesh.position.y += -center.y;
  }

  if (spec.shadow) {
    const shadowMaterial = buildMaterial(spec.useStandard);
    if (
      shadowMaterial instanceof THREE.MeshStandardMaterial ||
      shadowMaterial instanceof SlugMaterial
    ) {
      shadowMaterial.transparent = true;
      (shadowMaterial as any).opacity = spec.shadow.opacity;
      (shadowMaterial as any).depthWrite = false;
    }
    const shadowMesh = new THREE.Mesh(
      new SlugGeometry(glyphCapacity),
      shadowMaterial,
    );
    shadowMesh.position.copy(mesh.position);
    shadowMesh.position.x += spec.shadow.offsetX;
    shadowMesh.position.y += spec.shadow.offsetY;
    shadowMesh.scale.setScalar(spec.shadow.scale);
    (shadowMesh.geometry as SlugGeometry).addText(spec.text, loadedSlugData, {
      fontScale: spec.fontScale,
      lineHeight:
        baseLineHeight *
        (spec.lineHeightFactor ?? lineSpacing.value) *
        spec.fontScale,
      startX: 0,
      startY: 0,
      justify: "left",
      maxWidth: spec.maxWidth,
      wrap: spec.wrap,
      wrapMode: spec.wrapMode,
      glyphStyle: {
        color: [0, 0, 0, 1],
        params: [0, 0, 0, 0],
      },
    });
    const shadowBox = shadowMesh.geometry.boundingBox;
    if (shadowBox && !shadowBox.isEmpty()) {
      const center = new THREE.Vector3();
      shadowBox.getCenter(center);
      shadowMesh.position.x += -center.x;
      shadowMesh.position.y += -center.y;
    }
    addToScene(shadowMesh);
  }

  addToScene(mesh);
  return mesh;
}

function buildBenchmarkScene(): void {
  if (!scene || !loadedSlugData) return;
  clearScene();

  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  const key = new THREE.DirectionalLight(0xfff1cf, 1.2);
  key.position.set(2, 3, 5);
  const rim = new THREE.DirectionalLight(0x75c8ff, 0.65);
  rim.position.set(-4, -2, 3);
  addToScene(ambient);
  addToScene(key);
  addToScene(rim);

  const totalGlyphs = 100000;
  const glyphCycle = [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "K",
    "L",
  ];
  const geometry = new SlugGeometry(totalGlyphs);
  const mapWidth = 9200;
  const mapHeight = 5600;
  const random = createSeededRandom(1337);

  for (let index = 0; index < totalGlyphs; index++) {
    const char = glyphCycle[index % glyphCycle.length];
    const data = getGlyphData(char);
    if (!data) continue;

    const x = (random() - 0.5) * mapWidth;
    const y = (random() - 0.5) * mapHeight;
    const sizeJitter = 0.72 + random() * 0.24;
    const glyphW = 13.5 * sizeJitter;
    const glyphH = 16.0 * sizeJitter;

    geometry.addGlyph(data, x, y, glyphW, glyphH, 0, 0, {
      color: [
        0.55 + 0.45 * Math.sin(index * 0.0007),
        0.55 + 0.45 * Math.sin(index * 0.0011 + 1.0),
        0.55 + 0.45 * Math.sin(index * 0.0015 + 2.0),
        1,
      ],
      params: [index * 0.01, 8.0, 0.0, 0.0],
    });
  }

  const material = buildMaterial(false);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = 0;
  addToScene(mesh);

  buildTextMesh({
    text: "100k glyph instances benchmark",
    x: -620,
    y: 470,
    fontScale: 0.1,
    color: [1, 1, 1, 1],
    params: [0, 0, 0, 0],
    useStandard: false,
  });
}

function buildPlaygroundScene(): void {
  if (!scene || !loadedSlugData) return;
  clearScene();

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  const key = new THREE.DirectionalLight(0xfff1cf, 1.4);
  key.position.set(2, 3, 5);
  const rim = new THREE.DirectionalLight(0x75c8ff, 0.8);
  rim.position.set(-4, -2, 3);
  addToScene(ambient);
  addToScene(key);
  addToScene(rim);

  buildTextMesh({
    text: inputText.value,
    x: 0,
    y: 0,
    fontScale: fontScale.value,
    lineHeightFactor: lineSpacing.value,
    useStandard: materialMode.value === "standard",
  });

  buildTextMesh({
    text: "Auto wrap box in the top-right. This is a constrained text block showing word wrapping and live layout with animation-friendly shader params.",
    x: 420,
    y: 260,
    fontScale: 0.075,
    maxWidth: 320,
    wrap: true,
    wrapMode: "word",
    useStandard: materialMode.value === "standard",
    color: [0.92, 0.96, 1.0, 1],
    params: [0, 0, 0, 0.06],
    shadow: { offsetX: 12, offsetY: -12, scale: 1.02, opacity: 0.35 },
  });

  buildTextMesh({
    text: "Wavy text / rainbow mix / shadow / wrap / scale",
    x: -460,
    y: 290,
    fontScale: 0.085,
    maxWidth: 360,
    wrap: true,
    wrapMode: "word",
    useStandard: true,
    color: [1, 0.95, 0.75, 1],
    effects: [
      createWaveEffect("wave", frameCounter * 0.03, 15.0, 12.0),
      createRainbowEffect("rainbow", 0.75, frameCounter * 0.01),
      createPulseEffect("pulse", 0.18, frameCounter * 0.02),
    ],
    params: [1.0, 18.0, 0.0, 1.0],
    shadow: { offsetX: 10, offsetY: -10, scale: 1.02, opacity: 0.28 },
  });

  buildTextMesh({
    text: "Shadow block",
    x: -520,
    y: -250,
    fontScale: 0.12,
    useStandard: materialMode.value === "standard",
    color: [0.98, 0.75, 0.3, 1],
    params: [0, 0, 0, 0],
    shadow: { offsetX: 24, offsetY: -24, scale: 1.04, opacity: 0.35 },
  });
}

function buildEffectsScene(): void {
  if (!scene || !loadedSlugData) return;
  clearScene();

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const key = new THREE.DirectionalLight(0xfff1cf, 1.2);
  key.position.set(2, 3, 5);
  const rim = new THREE.DirectionalLight(0x75c8ff, 0.75);
  rim.position.set(-4, -2, 3);
  addToScene(ambient);
  addToScene(key);
  addToScene(rim);

  const titles = [
    "Effects canvas / infinite scroll",
    "Rainbow wave",
    "Auto wrap / shadow / scale",
    "Offset / stacked / boxed",
  ];

  buildTextMesh({
    text: titles[0],
    x: -780,
    y: 500,
    fontScale: 0.12,
    useStandard: true,
    color: [1, 1, 1, 1],
    params: [0, 0, 0, 0],
  });

  buildTextMesh({
    text: "RAINBOW WAVE RAINBOW WAVE RAINBOW WAVE",
    x: -900,
    y: 180,
    fontScale: 0.11,
    maxWidth: 460,
    wrap: true,
    wrapMode: "word",
    useStandard: true,
    color: [1, 1, 1, 1],
    effects: [
      createWaveEffect("wave", frameCounter * 0.08, 19.0, 20.0),
      createRainbowEffect("rainbow", 0.85, frameCounter * 0.02),
    ],
    params: [0.0, 20.0, 0.0, 1.0],
    shadow: { offsetX: 14, offsetY: -14, scale: 1.01, opacity: 0.28 },
  });

  buildTextMesh({
    text: "This box demonstrates automatic wrapping inside a fixed width, plus a generic per-glyph shader pipeline.",
    x: 760,
    y: 260,
    fontScale: 0.078,
    maxWidth: 300,
    wrap: true,
    wrapMode: "word",
    useStandard: true,
    color: [0.95, 0.95, 1, 1],
    effects: [createPulseEffect("pulse", 0.16, frameCounter * 0.03)],
    params: [0.0, 0.0, 0.0, 0.08],
    shadow: { offsetX: 18, offsetY: -18, scale: 1.02, opacity: 0.3 },
  });

  buildTextMesh({
    text: "Stacked shadows and offsets",
    x: -20,
    y: -360,
    fontScale: 0.115,
    useStandard: true,
    color: [0.6, 0.9, 1.0, 1],
    effects: [
      createWaveEffect("wave", frameCounter * 0.05, 9.0, 10.0),
      createPulseEffect("pulse", 0.1, frameCounter * 0.04),
    ],
    params: [0.2, 15.0, 0.0, 0.9],
    shadow: { offsetX: 20, offsetY: -20, scale: 1.03, opacity: 0.4 },
  });
}

function rebuildScene(): void {
  if (!scene || !loadedSlugData) return;
  if (activeTab.value === "benchmark") {
    buildBenchmarkScene();
    status.value = "100k glyph benchmark ready.";
    return;
  }
  if (activeTab.value === "effects") {
    buildEffectsScene();
    status.value = "Effects canvas ready.";
    return;
  }
  buildPlaygroundScene();
  status.value = "Slug demo ready.";
}

function loadSelectedFont(): void {
  const currentTicket = ++loadTicket;
  status.value = `Generating from ${selectedFont.value}...`;

  const cached = generatedCache.get(selectedFont.value);
  if (cached) {
    loadedSlugData = cached;
    rebuildScene();
    return;
  }

  slugGenerator
    .generateFromUrl(`/fonts/${selectedFont.value}`)
    .then((slugData) => {
      if (currentTicket !== loadTicket) return;
      generatedCache.set(selectedFont.value, slugData);
      loadedSlugData = slugData;
      rebuildScene();
    })
    .catch((error: unknown) => {
      if (currentTicket !== loadTicket) return;
      console.error(error);
      status.value = `Failed to generate from ${selectedFont.value}.`;
      loadedSlugData = null;
      disposeCurrentScene();
    });
}

onMounted(async () => {
  if (!host.value) return;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(backgroundColor.value);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.setClearColor(backgroundColor.value, 1);
  host.value.appendChild(renderer.domElement);
  applySceneBackground();

  setupCameraAndControls();

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host.value);
  window.addEventListener("resize", resize);
  resize();

  try {
    const response = await fetch("/fonts/fonts.json");
    const fonts = (await response.json()) as string[];
    availableFonts.value = fonts.filter((name) =>
      name.toLowerCase().endsWith(".ttf"),
    );
    if (availableFonts.value.length > 0) {
      selectedFont.value = availableFonts.value.includes(
        "SpaceMono-Regular.ttf",
      )
        ? "SpaceMono-Regular.ttf"
        : availableFonts.value[0];
    }
  } catch (error) {
    console.error(error);
    availableFonts.value = ["SpaceMono-Regular.ttf", "DejaVuSansMono.ttf"];
    selectedFont.value = "SpaceMono-Regular.ttf";
  }

  loadSelectedFont();

  const tick = () => {
    animationFrame = window.requestAnimationFrame(tick);
    if (renderer && scene && camera) {
      controls?.update();

      const elapsed = performance.now() * 0.001;
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.material) return;

        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const material of materials) {
          const runtimeUniforms = (material as any).userData
            ?.slugRuntimeUniforms;
          if (runtimeUniforms?.uSlugTime) {
            runtimeUniforms.uSlugTime.value = elapsed;
          }
        }
      });

      renderer.render(scene, camera);

      frameCounter++;
      if (frameCounter % 10 === 0) {
        renderInfo.value = {
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          lines: renderer.info.render.lines,
          points: renderer.info.render.points,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
        };
      }
    }
  };

  tick();
});

watch([selectedFont, activeTab], () => {
  if (!loadedSlugData) return;
  if (
    activeTab.value === "benchmark" ||
    activeTab.value === "effects" ||
    activeTab.value === "playground"
  ) {
    rebuildScene();
  }
});

watch([inputText, fontScale, lineSpacing, materialMode], () => {
  if (
    !loadedSlugData ||
    (activeTab.value !== "playground" && activeTab.value !== "effects")
  )
    return;
  rebuildScene();
});

watch([backgroundColor, usePageBackground], () => {
  applySceneBackground();
});

watch(cameraMode, () => {
  setupCameraAndControls();
});

onBeforeUnmount(() => {
  window.cancelAnimationFrame(animationFrame);
  window.removeEventListener("resize", resize);
  resizeObserver?.disconnect();
  controls?.dispose();

  disposeCurrentScene();

  renderer?.dispose();
  if (renderer?.domElement.parentElement) {
    renderer.domElement.parentElement.removeChild(renderer.domElement);
  }

  renderer = null;
  scene = null;
  camera = null;
  controls = null;
  loadedSlugData = null;
});
</script>

<template>
  <section class="demo-root">
    <div
      ref="host"
      class="fullscreen-canvas"
      aria-label="Slug render viewport"
    ></div>

    <aside class="overlay">
      <p class="kicker">Slug Text Demo</p>
      <h1>Slug Controls</h1>

      <div class="tabs">
        <button
          :class="{ active: activeTab === 'playground' }"
          @click="activeTab = 'playground'"
        >
          Playground
        </button>
        <button
          :class="{ active: activeTab === 'benchmark' }"
          @click="activeTab = 'benchmark'"
        >
          100k Benchmark
        </button>
        <button
          :class="{ active: activeTab === 'effects' }"
          @click="activeTab = 'effects'"
        >
          Effects
        </button>
      </div>

      <div class="row two">
        <label>
          Camera
          <select v-model="cameraMode">
            <option value="2d">2D (pan/zoom)</option>
            <option value="orbit">Orbit (3D)</option>
          </select>
        </label>

        <label>
          Material
          <select v-model="materialMode">
            <option value="slug">SlugMaterial</option>
            <option value="standard">MeshStandard+inject</option>
          </select>
        </label>
      </div>

      <div class="row two">
        <label>
          Background
          <input
            v-model="backgroundColor"
            type="color"
            :disabled="usePageBackground"
          />
        </label>

        <label>
          Mode
          <select v-model="usePageBackground">
            <option :value="false">Solid</option>
            <option :value="true">Page gradient</option>
          </select>
        </label>
      </div>

      <label>
        TTF Font
        <select v-model="selectedFont">
          <option v-for="font in availableFonts" :key="font" :value="font">
            {{ font }}
          </option>
        </select>
      </label>

      <label>
        Text
        <textarea
          v-model="inputText"
          rows="4"
          placeholder="Type your text here"
        />
      </label>

      <label>
        Scale: {{ fontScale.toFixed(2) }}
        <input
          v-model.number="fontScale"
          type="range"
          min="0.06"
          max="0.3"
          step="0.01"
        />
      </label>

      <label>
        Line Spacing: {{ lineSpacing.toFixed(2) }}
        <input
          v-model.number="lineSpacing"
          type="range"
          min="0.8"
          max="2"
          step="0.05"
        />
      </label>

      <p class="status">{{ status }}</p>
      <p class="hint">
        Auto-wrap boxes, wavy/rainbow glyph params, shadow layers, and a
        benchmark tab are built from the same instanced geometry pipeline.
      </p>

      <div class="stats">
        <p class="stats-title">renderer.info</p>
        <p>calls: {{ renderInfo.calls }}</p>
        <p>triangles: {{ renderInfo.triangles }}</p>
        <p>lines: {{ renderInfo.lines }}</p>
        <p>points: {{ renderInfo.points }}</p>
        <p>geometries: {{ renderInfo.geometries }}</p>
        <p>textures: {{ renderInfo.textures }}</p>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.demo-root {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.fullscreen-canvas {
  position: absolute;
  inset: 0;
}

.fullscreen-canvas :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.overlay {
  position: absolute;
  top: 12px;
  left: 12px;
  width: min(380px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: auto;
  padding: 12px;
  border-radius: 12px;
  background: rgba(4, 11, 20, 0.76);
  border: 1px solid rgba(136, 175, 255, 0.3);
  backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kicker {
  margin: 0;
  color: #89adff;
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: clamp(1.05rem, 1.9vw, 1.35rem);
  color: #f6fbff;
}

.tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.tabs button {
  border: 1px solid rgba(158, 187, 255, 0.34);
  border-radius: 8px;
  background: rgba(3, 9, 16, 0.84);
  color: #f8fbff;
  font-size: 0.75rem;
  padding: 8px 6px;
  cursor: pointer;
}

.tabs button.active {
  background: #2e6bff;
  border-color: #2e6bff;
}

.row.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.82rem;
  color: rgba(233, 244, 255, 0.92);
}

select,
textarea,
input[type="range"] {
  width: 100%;
}

select,
textarea {
  background: rgba(3, 9, 16, 0.84);
  color: #f8fbff;
  border: 1px solid rgba(158, 187, 255, 0.34);
  border-radius: 8px;
  padding: 7px 8px;
}

textarea {
  resize: vertical;
  min-height: 60px;
}

.status {
  margin: 0;
  color: #ffd57f;
  font-size: 0.8rem;
}

.hint {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.35;
  color: rgba(190, 210, 255, 0.9);
}

.stats {
  margin-top: 4px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgba(148, 175, 255, 0.25);
  background: rgba(2, 7, 12, 0.65);
}

.stats-title {
  margin: 0 0 4px;
  font-size: 0.78rem;
  color: #8cb2ff;
}

.stats p {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.25;
}

@media (max-width: 640px) {
  .overlay {
    width: calc(100vw - 16px);
    top: 8px;
    left: 8px;
  }

  .row.two,
  .tabs {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SlugGenerator, SlugLoader } from "../library";
import {
  buildBenchmarkScene,
  buildPlaygroundScene,
  clearScene,
  disposeSceneRoot,
  updateSlugRuntimeUniforms,
} from "./slug-demo/sceneBuilders";
import type {
  CameraMode,
  MaterialMode,
  RenderSlugData,
  TabId,
} from "./slug-demo/types";

const host = ref<HTMLDivElement | null>(null);
const status = ref("Initializing renderer...");
const inputText = ref("TS Slug\nTypeScript Port");
const fontScale = ref(0.14);
const lineSpacing = ref(1.15);
const cameraMode = ref<CameraMode>("2d");
const activeTab = ref<TabId>("playground");
const sourceMode = ref<"ttf" | "sluggish">("ttf");
const materialMode = ref<MaterialMode>("slug");
const backgroundColor = ref("#c7cdd5");
const usePageBackground = ref(false);
const selectedFont = ref("SpaceMono-Regular.ttf");
const availableFonts = ref<string[]>([]);
const selectedSluggishSource = ref("custom");
const availableSluggishSources = ref<string[]>([]);
const customSluggishFile = ref<File | null>(null);
const renderInfo = ref({
  fps: 0,
  avgFps: 0,
  low1Fps: 0,
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
let lastFrameTime = 0;
let sceneRoot: THREE.Group | null = null;
const fpsSamples: number[] = [];
const maxFpsSamples = 600;

const slugGenerator = new SlugGenerator({ fullRange: true });
const slugLoader = new SlugLoader();
const generatedCache = new Map<string, RenderSlugData>();
const importedCache = new Map<string, RenderSlugData>();
const publicAssetBase = import.meta.env.BASE_URL;

function getPublicAssetUrl(path: string): string {
  const normalizedBase = publicAssetBase.endsWith("/")
    ? publicAssetBase
    : `${publicAssetBase}/`;
  return `${normalizedBase}${path.replace(/^\//, "")}`;
}

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

function rebuildScene(): void {
  if (!scene || !loadedSlugData) return;

  sceneRoot = clearScene(scene, sceneRoot);

  const params = {
    sceneRoot,
    loadedSlugData,
    materialMode: materialMode.value,
    lineSpacing: lineSpacing.value,
    frameCounter,
    inputText: inputText.value,
    fontScale: fontScale.value,
  };

  if (activeTab.value === "benchmark") {
    buildBenchmarkScene(params);
    status.value = "100k glyph benchmark ready.";
    return;
  }

  buildPlaygroundScene(params);
  status.value = "Slug demo ready.";
}

function clearLoadedSlugData(statusText?: string): void {
  loadedSlugData = null;
  if (scene && sceneRoot) {
    disposeSceneRoot(scene, sceneRoot);
    sceneRoot = null;
  }

  if (statusText) {
    status.value = statusText;
  }
}

async function loadSelectedFont(): Promise<void> {
  const currentTicket = ++loadTicket;
  status.value = `Generating from ${selectedFont.value}...`;

  const cached = generatedCache.get(selectedFont.value);
  if (cached) {
    loadedSlugData = cached;
    rebuildScene();
    return;
  }

  slugGenerator
    .generateFromUrl(
      getPublicAssetUrl(`fonts/${encodeURIComponent(selectedFont.value)}`),
    )
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
      clearLoadedSlugData();
    });
}

async function loadCustomSluggishFile(file: File): Promise<void> {
  const cacheKey = `${file.name}:${file.size}:${file.lastModified}`;
  const cached = importedCache.get(cacheKey);
  if (cached) {
    loadedSlugData = cached;
    rebuildScene();
    return;
  }

  const currentTicket = ++loadTicket;
  status.value = `Importing ${file.name}...`;

  try {
    const buffer = await file.arrayBuffer();
    if (currentTicket !== loadTicket) return;
    const slugData = slugLoader.parse(buffer);
    if (currentTicket !== loadTicket) return;
    importedCache.set(cacheKey, slugData);
    loadedSlugData = slugData;
    rebuildScene();
  } catch (error) {
    if (currentTicket !== loadTicket) return;
    console.error(error);
    clearLoadedSlugData(`Failed to import ${file.name}.`);
  }
}

async function loadSelectedSluggishSource(): Promise<void> {
  const sourceName = selectedSluggishSource.value;

  if (sourceName !== "custom") {
    const currentTicket = ++loadTicket;
    status.value = `Importing ${sourceName}...`;

    const cached = importedCache.get(sourceName);
    if (cached) {
      loadedSlugData = cached;
      rebuildScene();
      return;
    }

    try {
      const response = await fetch(
        getPublicAssetUrl(`fonts/${encodeURIComponent(sourceName)}`),
      );
      if (!response.ok) {
        throw new Error(`Unable to fetch ${sourceName}`);
      }

      const buffer = await response.arrayBuffer();
      if (currentTicket !== loadTicket) return;
      const slugData = slugLoader.parse(buffer);
      if (currentTicket !== loadTicket) return;
      importedCache.set(sourceName, slugData);
      loadedSlugData = slugData;
      rebuildScene();
    } catch (error) {
      if (currentTicket !== loadTicket) return;
      console.error(error);
      clearLoadedSlugData(`Failed to import ${sourceName}.`);
    }
    return;
  }

  if (!customSluggishFile.value) {
    clearLoadedSlugData("Choose a .sluggish file to import.");
    return;
  }

  await loadCustomSluggishFile(customSluggishFile.value);
}

async function loadSelectedAsset(): Promise<void> {
  if (sourceMode.value === "sluggish") {
    await loadSelectedSluggishSource();
    return;
  }

  await loadSelectedFont();
}

function onCustomSluggishFileChange(event: Event): void {
  const target = event.target as HTMLInputElement | null;
  customSluggishFile.value = target?.files?.[0] ?? null;
  if (
    sourceMode.value === "sluggish" &&
    selectedSluggishSource.value === "custom"
  ) {
    void loadSelectedSluggishSource();
  }
}

function computeFpsMetrics(samples: number[]): {
  fps: number;
  avgFps: number;
  low1Fps: number;
} {
  if (samples.length === 0) {
    return { fps: 0, avgFps: 0, low1Fps: 0 };
  }

  const fps = samples[samples.length - 1];
  const avgFps =
    samples.reduce((sum, value) => sum + value, 0) / samples.length;

  const sorted = [...samples].sort((a, b) => a - b);
  const lowCount = Math.max(1, Math.floor(sorted.length * 0.01));
  const lowSlice = sorted.slice(0, lowCount);
  const low1Fps =
    lowSlice.reduce((sum, value) => sum + value, 0) / lowSlice.length;

  return {
    fps,
    avgFps,
    low1Fps,
  };
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
    const response = await fetch(getPublicAssetUrl("fonts/fonts.json"));
    const fonts = (await response.json()) as string[];
    availableFonts.value = fonts.filter((name) =>
      name.toLowerCase().endsWith(".ttf"),
    );
    availableSluggishSources.value = fonts.filter((name) =>
      name.toLowerCase().endsWith(".sluggish"),
    );
    if (availableFonts.value.length > 0) {
      selectedFont.value = availableFonts.value.includes(
        "SpaceMono-Regular.ttf",
      )
        ? "SpaceMono-Regular.ttf"
        : availableFonts.value[0];
    }
    if (availableSluggishSources.value.length > 0) {
      selectedSluggishSource.value = availableSluggishSources.value[0];
    }
  } catch (error) {
    console.error(error);
    availableFonts.value = ["SpaceMono-Regular.ttf", "DejaVuSansMono.ttf"];
    availableSluggishSources.value = [];
    selectedFont.value = "SpaceMono-Regular.ttf";
  }

  void loadSelectedAsset();

  const tick = () => {
    animationFrame = window.requestAnimationFrame(tick);
    if (renderer && scene && camera) {
      const now = performance.now();
      if (lastFrameTime > 0) {
        const deltaMs = Math.max(now - lastFrameTime, 0.0001);
        const fps = 1000 / deltaMs;
        fpsSamples.push(fps);
        if (fpsSamples.length > maxFpsSamples) fpsSamples.shift();
      }
      lastFrameTime = now;

      controls?.update();

      const elapsed = now * 0.001;
      updateSlugRuntimeUniforms(scene, elapsed);
      renderer.render(scene, camera);

      frameCounter++;
      if (frameCounter % 10 === 0) {
        const fpsMetrics = computeFpsMetrics(fpsSamples);
        renderInfo.value = {
          fps: fpsMetrics.fps,
          avgFps: fpsMetrics.avgFps,
          low1Fps: fpsMetrics.low1Fps,
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

watch(sourceMode, () => {
  void loadSelectedAsset();
});

watch(selectedFont, () => {
  if (sourceMode.value === "ttf") {
    void loadSelectedAsset();
  }
});

watch(selectedSluggishSource, () => {
  if (sourceMode.value === "sluggish") {
    void loadSelectedSluggishSource();
  }
});

watch([activeTab, inputText, fontScale, lineSpacing, materialMode], () => {
  if (!loadedSlugData) return;
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

  if (scene && sceneRoot) {
    disposeSceneRoot(scene, sceneRoot);
    sceneRoot = null;
  }

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
      </div>

      <div class="control-group">
        <p class="group-title">View</p>
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
      </div>

      <div class="control-group">
        <p class="group-title">Source</p>
        <label>
          Source Type
          <select v-model="sourceMode">
            <option value="ttf">Generate from TTF</option>
            <option value="sluggish">Import sluggish</option>
          </select>
        </label>

        <template v-if="sourceMode === 'ttf'">
          <label>
            TTF Font
            <select v-model="selectedFont">
              <option v-for="font in availableFonts" :key="font" :value="font">
                {{ font }}
              </option>
            </select>
          </label>
        </template>

        <template v-else>
          <label>
            Sluggish Source
            <select v-model="selectedSluggishSource">
              <option value="custom">Custom file upload</option>
              <option
                v-for="source in availableSluggishSources"
                :key="source"
                :value="source"
              >
                {{ source }}
              </option>
            </select>
          </label>

          <label v-if="selectedSluggishSource === 'custom'">
            Import .sluggish file
            <input
              type="file"
              accept=".sluggish,application/octet-stream"
              @change="onCustomSluggishFileChange"
            />
          </label>
        </template>
      </div>

      <div class="control-group">
        <p class="group-title">Text</p>
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
      </div>

      <p class="status">{{ status }}</p>
      <p class="hint">
        Auto-wrap boxes, wavy/rainbow glyph params, shadow layers, and a
        benchmark tab are built from the same instanced geometry pipeline. In
        sluggish import mode, the renderer uses your generated .sluggish file
        directly.
      </p>

      <div class="stats">
        <p class="stats-title">renderer.info</p>
        <p>fps: {{ renderInfo.fps.toFixed(1) }}</p>
        <p>avg fps: {{ renderInfo.avgFps.toFixed(1) }}</p>
        <p>1% low: {{ renderInfo.low1Fps.toFixed(1) }}</p>
        <p>calls: {{ renderInfo.calls }}</p>
        <p>triangles: {{ renderInfo.triangles }}</p>
        <p>lines: {{ renderInfo.lines }}</p>
        <p>points: {{ renderInfo.points }}</p>
        <p>geometries: {{ renderInfo.geometries }}</p>
        <p>textures: {{ renderInfo.textures }}</p>
      </div>

      <div class="credits">
        <p class="credits-title">Credits</p>
        <p>
          Original project:
          <a
            href="https://github.com/manthrax/JSlug"
            target="_blank"
            rel="noreferrer"
          >
            manthrax/JSlug
          </a>
          . Slug itself is credited by that project to Eric Lengyel, and this
          port also leans on opentype.js and Three.js.
        </p>
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
  width: min(440px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: auto;
  padding: 14px;
  border-radius: 12px;
  background: rgba(4, 11, 20, 0.76);
  border: 1px solid rgba(136, 175, 255, 0.3);
  backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.control-group {
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(143, 172, 242, 0.22);
  background: rgba(2, 8, 14, 0.52);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-title {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(158, 191, 255, 0.92);
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
  grid-template-columns: repeat(2, 1fr);
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
  color: rgba(234, 244, 255, 0.94);
}

.credits {
  margin-top: 4px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgba(148, 175, 255, 0.25);
  background: rgba(2, 7, 12, 0.5);
}

.credits-title {
  margin: 0 0 4px;
  font-size: 0.78rem;
  color: #8cb2ff;
}

.credits p:last-child {
  margin: 0;
  font-size: 0.72rem;
  line-height: 1.35;
  color: rgba(234, 244, 255, 0.9);
}

.credits a {
  color: #9ec0ff;
  text-decoration: underline;
  text-underline-offset: 2px;
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

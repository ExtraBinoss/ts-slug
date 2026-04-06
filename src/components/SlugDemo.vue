<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  SlugGeometry,
  SlugGenerator,
  SlugMaterial,
  injectSlug,
  type SlugGeneratedData,
  type SlugLoaderData,
} from '../library';

const host = ref<HTMLDivElement | null>(null);
const status = ref('Initializing renderer...');
const inputText = ref('TS Slug\nTypeScript Port');
const fontScale = ref(0.14);
const lineSpacing = ref(1.15);
const useInjectedStandard = ref(false);
const cameraMode = ref<'2d' | 'orbit'>('2d');
const selectedFont = ref('SpaceMono-Regular.ttf');
const availableFonts = ref<string[]>([]);
const renderInfo = ref({
  calls: 0,
  triangles: 0,
  lines: 0,
  points: 0,
  geometries: 0,
  textures: 0,
});

type RenderSlugData = SlugLoaderData | SlugGeneratedData;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null = null;
let controls: OrbitControls | null = null;
let resizeObserver: ResizeObserver | null = null;
let animationFrame = 0;
let textMesh: THREE.Mesh | null = null;
let loadedSlugData: RenderSlugData | null = null;
let loadTicket = 0;
let frameCounter = 0;
const slugGenerator = new SlugGenerator({ fullRange: true });
const generatedCache = new Map<string, RenderSlugData>();

function disposeTextMesh(): void {
  if (!scene || !textMesh) return;

  scene.remove(textMesh);
  textMesh.geometry.dispose();

  if (Array.isArray(textMesh.material)) {
    for (const material of textMesh.material) material.dispose();
  } else {
    textMesh.material.dispose();
  }

  textMesh = null;
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

  if (cameraMode.value === 'orbit') {
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 8000);
    camera.position.set(0, 0, 1200);
  } else {
    camera = new THREE.OrthographicCamera(-500, 500, 500, -500, -5000, 5000);
    camera.position.set(0, 0, 1200);
  }

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.target.set(0, 0, 0);

  if (cameraMode.value === 'orbit') {
    controls.enableRotate = true;
    controls.minDistance = 50;
    controls.maxDistance = 6000;
  } else {
    controls.enableRotate = false;
    controls.minZoom = 0.2;
    controls.maxZoom = 20;
    controls.zoomSpeed = 1.2;
  }

  controls.update();
  resize();
}

function buildTextMesh(): void {
  if (!scene || !camera || !loadedSlugData) return;

  disposeTextMesh();

  const glyphCapacity = Math.max(256, inputText.value.length * 4);
  const geometry = new SlugGeometry(glyphCapacity);

  const baseLineHeight = loadedSlugData.unitsPerEm > 0
    ? loadedSlugData.ascender - loadedSlugData.descender + loadedSlugData.lineGap
    : 2000;

  geometry.addText(inputText.value, loadedSlugData, {
    fontScale: fontScale.value,
    lineHeight: baseLineHeight * lineSpacing.value * fontScale.value,
    startX: 0,
    startY: 0,
    justify: 'left',
  });

  const material = useInjectedStandard.value
    ? new THREE.MeshStandardMaterial({
        color: 0xffd37a,
        roughness: 0.45,
        metalness: 0.08,
        side: THREE.DoubleSide,
      })
    : new SlugMaterial({
        curvesTex: loadedSlugData.curvesTex,
        bandsTex: loadedSlugData.bandsTex,
      });

  const mesh = new THREE.Mesh(geometry, material);

  if (useInjectedStandard.value) {
    injectSlug(mesh, material as THREE.Material, loadedSlugData);
  }

  const box = geometry.boundingBox;
  if (box && !box.isEmpty()) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    mesh.position.x = -center.x;
    mesh.position.y = -center.y;
  }

  scene.add(mesh);
  textMesh = mesh;
  status.value = 'Slug demo ready.';
}

function loadSelectedFont(): void {
  const currentTicket = ++loadTicket;
  status.value = `Generating from ${selectedFont.value}...`;

  const cached = generatedCache.get(selectedFont.value);
  if (cached) {
    loadedSlugData = cached;
    buildTextMesh();
    return;
  }

  slugGenerator
    .generateFromUrl(`/fonts/${selectedFont.value}`)
    .then((slugData) => {
      if (currentTicket !== loadTicket) return;
      generatedCache.set(selectedFont.value, slugData);
      loadedSlugData = slugData;
      buildTextMesh();
    })
    .catch((error: unknown) => {
      if (currentTicket !== loadTicket) return;
      console.error(error);
      status.value = `Failed to generate from ${selectedFont.value}.`;
      loadedSlugData = null;
      disposeTextMesh();
    });
}

onMounted(async () => {
  if (!host.value) return;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050b13);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  host.value.appendChild(renderer.domElement);

  setupCameraAndControls();

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xfff1cf, 1.4);
  key.position.set(2, 3, 5);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x75c8ff, 0.8);
  rim.position.set(-4, -2, 3);
  scene.add(rim);

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host.value);
  window.addEventListener('resize', resize);
  resize();

  try {
    const response = await fetch('/fonts/fonts.json');
    const fonts = (await response.json()) as string[];
    availableFonts.value = fonts.filter((name) => name.toLowerCase().endsWith('.ttf'));
    if (availableFonts.value.length > 0) {
      selectedFont.value = availableFonts.value.includes('SpaceMono-Regular.ttf')
        ? 'SpaceMono-Regular.ttf'
        : availableFonts.value[0];
    }
  } catch (error) {
    console.error(error);
    availableFonts.value = ['SpaceMono-Regular.ttf', 'DejaVuSansMono.ttf'];
    selectedFont.value = 'SpaceMono-Regular.ttf';
  }

  loadSelectedFont();

  const tick = () => {
    animationFrame = window.requestAnimationFrame(tick);
    if (renderer && scene && camera) {
      controls?.update();
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

watch(selectedFont, () => {
  loadSelectedFont();
});

watch(cameraMode, () => {
  setupCameraAndControls();
});

watch([inputText, fontScale, lineSpacing, useInjectedStandard], () => {
  if (!loadedSlugData) return;
  buildTextMesh();
});

onBeforeUnmount(() => {
  window.cancelAnimationFrame(animationFrame);
  window.removeEventListener('resize', resize);
  resizeObserver?.disconnect();
  controls?.dispose();

  disposeTextMesh();

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
    <div ref="host" class="fullscreen-canvas" aria-label="Slug render viewport"></div>

    <aside class="overlay">
      <p class="kicker">Slug Text Demo</p>
      <h1>Slug Controls</h1>

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
          <select v-model="useInjectedStandard">
            <option :value="false">SlugMaterial</option>
            <option :value="true">MeshStandard+inject</option>
          </select>
        </label>
      </div>

      <label>
        TTF Font
        <select v-model="selectedFont">
          <option v-for="font in availableFonts" :key="font" :value="font">{{ font }}</option>
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
        injectSlug(mesh, MeshStandardMaterial, slugData) garde l'eclairage PBR / shadows standards
        tout en remplaçant le test alpha par le traçage Slug dans le shader compilé.
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
  width: min(360px, calc(100vw - 24px));
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
  margin: 0 0 4px;
  font-size: clamp(1.05rem, 1.9vw, 1.35rem);
  color: #f6fbff;
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
input[type='range'] {
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

  .row.two {
    grid-template-columns: 1fr;
  }
}
</style>

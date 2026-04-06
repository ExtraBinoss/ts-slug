<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
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
const selectedFont = ref('SpaceMono-Regular.ttf');
const availableFonts = ref<string[]>([]);

type RenderSlugData = SlugLoaderData | SlugGeneratedData;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let resizeObserver: ResizeObserver | null = null;
let animationFrame = 0;
let textMesh: THREE.Mesh | null = null;
let loadedSlugData: RenderSlugData | null = null;
let loadTicket = 0;
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
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
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

  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  camera.position.set(0, 0, 900);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  host.value.appendChild(renderer.domElement);

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
      renderer.render(scene, camera);
    }
  };

  tick();
});

watch(selectedFont, () => {
  loadSelectedFont();
});

watch([inputText, fontScale, lineSpacing, useInjectedStandard], () => {
  if (!loadedSlugData) return;
  buildTextMesh();
});

onBeforeUnmount(() => {
  window.cancelAnimationFrame(animationFrame);
  window.removeEventListener('resize', resize);
  resizeObserver?.disconnect();

  disposeTextMesh();

  renderer?.dispose();
  if (renderer?.domElement.parentElement) {
    renderer.domElement.parentElement.removeChild(renderer.domElement);
  }

  renderer = null;
  scene = null;
  camera = null;
  loadedSlugData = null;
});
</script>

<template>
  <section class="demo-root">
    <div ref="host" class="fullscreen-canvas" aria-label="Slug render viewport"></div>

    <aside class="overlay">
      <p class="kicker">Slug Text Demo</p>
      <h1>Fullscreen Canvas + Live Controls</h1>

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

      <label class="switch-row">
        <input v-model="useInjectedStandard" type="checkbox" />
        Use MeshStandard + injectSlug
      </label>

      <p class="status">{{ status }}</p>
      <p class="status">Pipeline: TTF -> SlugGenerator -> GPU textures</p>
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
  top: 18px;
  left: 18px;
  width: min(430px, calc(100vw - 36px));
  padding: 18px;
  border-radius: 18px;
  background: rgba(4, 11, 20, 0.76);
  border: 1px solid rgba(136, 175, 255, 0.3);
  backdrop-filter: blur(14px);
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  font-size: clamp(1.25rem, 2.2vw, 1.7rem);
  color: #f6fbff;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.92rem;
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
  border-radius: 10px;
  padding: 9px 11px;
}

textarea {
  resize: vertical;
  min-height: 70px;
}

.switch-row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.status {
  margin: 2px 0 0;
  color: #ffd57f;
  font-size: 0.9rem;
}

@media (max-width: 640px) {
  .overlay {
    top: 12px;
    left: 12px;
    width: calc(100vw - 24px);
    padding: 14px;
  }
}
</style>

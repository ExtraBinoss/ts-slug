import * as THREE from "three";
import {
  SlugGeometry,
  SlugMaterial,
  injectSlug,
  type SlugShaderEffect,
} from "../../library";
import {
  createPulseEffect,
  createRainbowEffect,
  createWaveEffect,
} from "./effects";
import type { BuildSceneParams, RenderSlugData, SceneMeshSpec } from "./types";

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

function getGlyphData(loadedSlugData: RenderSlugData, char: string) {
  const codePoint = char.codePointAt(0) ?? 0;
  return (
    loadedSlugData.codePoints.get(codePoint) ||
    loadedSlugData.codePoints.get(-1) ||
    null
  );
}

function buildMaterial(
  loadedSlugData: RenderSlugData,
  materialMode: "slug" | "standard",
  useStandard?: boolean,
  effects: SlugShaderEffect[] = [],
): THREE.Material {
  const shouldUseStandard =
    effects.length > 0 || (useStandard ?? materialMode === "standard");

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

function buildTextMesh(
  spec: SceneMeshSpec,
  sceneRoot: THREE.Group,
  loadedSlugData: RenderSlugData,
  materialMode: "slug" | "standard",
  lineSpacing: number,
): THREE.Mesh | null {
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
      baseLineHeight * (spec.lineHeightFactor ?? lineSpacing) * spec.fontScale,
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

  const material = buildMaterial(
    loadedSlugData,
    materialMode,
    spec.useStandard,
    spec.effects,
  );
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

  const addLayer = (options: {
    offsetX: number;
    offsetY: number;
    scale: number;
    opacity: number;
    color: [number, number, number];
    renderOrder: number;
  }): void => {
    const layerMaterial = buildMaterial(
      loadedSlugData,
      materialMode,
      spec.useStandard,
      spec.effects,
    );

    if (
      layerMaterial instanceof THREE.MeshStandardMaterial ||
      layerMaterial instanceof SlugMaterial
    ) {
      layerMaterial.transparent = true;
      (layerMaterial as any).depthWrite = false;
      (layerMaterial as any).depthTest = false;
    }

    const layerMesh = new THREE.Mesh(
      new SlugGeometry(glyphCapacity),
      layerMaterial,
    );
    layerMesh.position.copy(mesh.position);
    layerMesh.position.x += options.offsetX;
    layerMesh.position.y += options.offsetY;
    layerMesh.scale.setScalar(options.scale);
    layerMesh.renderOrder = options.renderOrder;

    (layerMesh.geometry as SlugGeometry).addText(spec.text, loadedSlugData, {
      fontScale: spec.fontScale,
      lineHeight:
        baseLineHeight *
        (spec.lineHeightFactor ?? lineSpacing) *
        spec.fontScale,
      startX: 0,
      startY: 0,
      justify: "left",
      maxWidth: spec.maxWidth,
      wrap: spec.wrap,
      wrapMode: spec.wrapMode,
      glyphStyle: {
        color: [
          options.color[0],
          options.color[1],
          options.color[2],
          options.opacity,
        ],
        params: spec.params || [0, 0, 0, 0],
      },
    });

    sceneRoot.add(layerMesh);
  };

  if (spec.outline) {
    addLayer({
      offsetX: spec.outline.offsetX,
      offsetY: spec.outline.offsetY,
      scale: spec.outline.scale,
      opacity: spec.outline.opacity,
      color: spec.outline.color || [0.02, 0.02, 0.02],
      renderOrder: 5,
    });
  }

  if (spec.shadow) {
    addLayer({
      offsetX: spec.shadow.offsetX,
      offsetY: spec.shadow.offsetY,
      scale: spec.shadow.scale,
      opacity: spec.shadow.opacity,
      color: [0, 0, 0],
      renderOrder: 10,
    });
  }

  mesh.renderOrder = 20;
  sceneRoot.add(mesh);
  return mesh;
}

function addCommonLights(
  sceneRoot: THREE.Group,
  ambientIntensity: number,
  keyIntensity: number,
  rimIntensity: number,
): void {
  const ambient = new THREE.AmbientLight(0xffffff, ambientIntensity);
  const key = new THREE.DirectionalLight(0xfff1cf, keyIntensity);
  key.position.set(2, 3, 5);
  const rim = new THREE.DirectionalLight(0x75c8ff, rimIntensity);
  rim.position.set(-4, -2, 3);
  sceneRoot.add(ambient);
  sceneRoot.add(key);
  sceneRoot.add(rim);
}

function addPlaygroundFontScaleStrip(
  sceneRoot: THREE.Group,
  loadedSlugData: RenderSlugData,
  materialMode: "slug" | "standard",
  lineSpacing: number,
): void {
  const samples = [3, 6, 9, 12, 16, 24, 32];
  const baseSamplePx = 32;
  const baseSampleScale = 0.09;
  const startY = -430;
  const rowGap = 62;

  buildTextMesh(
    {
      text: "Font scale preview",
      x: -720,
      y: -390,
      fontScale: 0.06,
      color: [0.85, 0.92, 1.0, 1],
      useStandard: materialMode === "standard",
    },
    sceneRoot,
    loadedSlugData,
    materialMode,
    lineSpacing,
  );

  for (let index = 0; index < samples.length; index++) {
    const px = samples[index];
    const sampleScale = baseSampleScale * (px / baseSamplePx);

    buildTextMesh(
      {
        text: `${px.toString().padStart(2, " ")}px   Aa   00`,
        x: -740,
        y: startY - index * rowGap,
        fontScale: sampleScale,
        color: [1, 1, 1, 1],
        useStandard: materialMode === "standard",
      },
      sceneRoot,
      loadedSlugData,
      materialMode,
      lineSpacing,
    );
  }
}

export function clearScene(
  scene: THREE.Scene,
  sceneRoot: THREE.Group | null,
): THREE.Group {
  if (sceneRoot) {
    scene.remove(sceneRoot);
    disposeObject(sceneRoot);
  }
  const nextRoot = new THREE.Group();
  scene.add(nextRoot);
  return nextRoot;
}

export function disposeObject(object: THREE.Object3D): void {
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

export function disposeSceneRoot(
  scene: THREE.Scene,
  sceneRoot: THREE.Group | null,
): void {
  if (!sceneRoot) return;
  scene.remove(sceneRoot);
  disposeObject(sceneRoot);
}

export function buildBenchmarkScene(params: BuildSceneParams): void {
  const { sceneRoot, loadedSlugData, materialMode, lineSpacing } = params;

  addCommonLights(sceneRoot, 0.45, 1.2, 0.65);

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
    const data = getGlyphData(loadedSlugData, char);
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

  // Finalize GPU upload and bounds for manual addGlyph path.
  geometry.updateBuffers();

  const material = buildMaterial(loadedSlugData, materialMode, false);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = 0;
  // The benchmark cloud spans a very large area; avoid aggressive frustum clipping.
  mesh.frustumCulled = false;
  sceneRoot.add(mesh);

  buildTextMesh(
    {
      text: "100k glyph instances benchmark",
      x: -620,
      y: 470,
      fontScale: 0.1,
      color: [1, 1, 1, 1],
      params: [0, 0, 0, 0],
      useStandard: false,
    },
    sceneRoot,
    loadedSlugData,
    materialMode,
    lineSpacing,
  );
}

export function buildPlaygroundScene(params: BuildSceneParams): void {
  const {
    sceneRoot,
    loadedSlugData,
    materialMode,
    lineSpacing,
    frameCounter,
    inputText,
    fontScale,
  } = params;

  addCommonLights(sceneRoot, 0.6, 1.4, 0.8);

  buildTextMesh(
    {
      text: inputText,
      x: 0,
      y: 40,
      fontScale,
      lineHeightFactor: lineSpacing,
      useStandard: materialMode === "standard",
    },
    sceneRoot,
    loadedSlugData,
    materialMode,
    lineSpacing,
  );

  buildTextMesh(
    {
      text: "Auto wrap box in the top-right. This is a constrained text block showing word wrapping and live layout with animation-friendly shader params.",
      x: 1120,
      y: 250,
      fontScale: 0.076,
      lineHeightFactor: 1.28,
      maxWidth: 340,
      wrap: true,
      wrapMode: "word",
      useStandard: materialMode === "standard",
      color: [0.92, 0.96, 1.0, 1],
      params: [0, 0, 0, 0.06],
      outline: {
        offsetX: 0,
        offsetY: 0,
        scale: 1.05,
        opacity: 0.85,
        color: [0.05, 0.05, 0.05],
      },
    },
    sceneRoot,
    loadedSlugData,
    materialMode,
    lineSpacing,
  );

  buildTextMesh(
    {
      text: "Wavy text / rainbow mix / shadow / wrap / scale",
      x: -760,
      y: 340,
      fontScale: 0.078,
      maxWidth: 300,
      wrap: true,
      wrapMode: "word",
      useStandard: true,
      color: [1, 0.95, 0.75, 1],
      effects: [
        createWaveEffect("wave", frameCounter * 0.03, 5.0, 7.0),
        createRainbowEffect("rainbow", 0.65, frameCounter * 0.01),
        createPulseEffect("pulse", 0.2, frameCounter * 0.02),
      ],
      params: [1.0, 4.0, 3.0, 0.65],
      shadow: { offsetX: 14, offsetY: -14, scale: 1.02, opacity: 0.3 },
    },
    sceneRoot,
    loadedSlugData,
    materialMode,
    lineSpacing,
  );

  buildTextMesh(
    {
      text: "Shadow block\n(only this one)",
      x: 1240,
      y: -170,
      fontScale: 0.12,
      lineHeightFactor: 1.2,
      useStandard: true,
      color: [0.98, 0.75, 0.3, 1],
      effects: [
        createWaveEffect("wave", frameCounter * 0.03, 4.5, 8.0),
        createRainbowEffect("rainbow", 0.55, frameCounter * 0.02),
        createPulseEffect("pulse", 0.22, frameCounter * 0.02),
      ],
      params: [0.6, 3.5, 3.5, 0.55],
      shadow: { offsetX: 18, offsetY: -18, scale: 1.03, opacity: 0.35 },
    },
    sceneRoot,
    loadedSlugData,
    materialMode,
    lineSpacing,
  );

  addPlaygroundFontScaleStrip(
    sceneRoot,
    loadedSlugData,
    materialMode,
    lineSpacing,
  );
}

export function buildEffectsScene(params: BuildSceneParams): void {
  const { sceneRoot, loadedSlugData, materialMode, lineSpacing, frameCounter } =
    params;

  addCommonLights(sceneRoot, 0.55, 1.2, 0.75);

  buildTextMesh(
    {
      text: "Effects canvas / infinite scroll",
      x: -780,
      y: 500,
      fontScale: 0.12,
      useStandard: true,
      color: [1, 1, 1, 1],
      params: [0, 0, 0, 0],
    },
    sceneRoot,
    loadedSlugData,
    materialMode,
    lineSpacing,
  );

  buildTextMesh(
    {
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
        createWaveEffect("wave", frameCounter * 0.08, 5.0, 8.0),
        createRainbowEffect("rainbow", 0.75, frameCounter * 0.02),
      ],
      params: [0.0, 4.0, 3.5, 0.75],
      shadow: { offsetX: 14, offsetY: -14, scale: 1.02, opacity: 0.28 },
    },
    sceneRoot,
    loadedSlugData,
    materialMode,
    lineSpacing,
  );

  buildTextMesh(
    {
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
      shadow: { offsetX: 16, offsetY: -16, scale: 1.02, opacity: 0.24 },
    },
    sceneRoot,
    loadedSlugData,
    materialMode,
    lineSpacing,
  );

  buildTextMesh(
    {
      text: "Stacked shadows and offsets",
      x: -20,
      y: -360,
      fontScale: 0.115,
      useStandard: true,
      color: [0.6, 0.9, 1.0, 1],
      effects: [
        createWaveEffect("wave", frameCounter * 0.05, 4.0, 6.0),
        createPulseEffect("pulse", 0.2, frameCounter * 0.04),
      ],
      params: [0.2, 3.5, 2.8, 0.6],
      shadow: { offsetX: 18, offsetY: -18, scale: 1.03, opacity: 0.32 },
    },
    sceneRoot,
    loadedSlugData,
    materialMode,
    lineSpacing,
  );
}

export function updateSlugRuntimeUniforms(
  scene: THREE.Scene,
  elapsed: number,
): void {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    for (const material of materials) {
      const runtimeUniforms = (material as any).userData?.slugRuntimeUniforms;
      if (runtimeUniforms?.uSlugTime) {
        runtimeUniforms.uSlugTime.value = elapsed;
      }
    }
  });
}

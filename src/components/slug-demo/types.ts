import type * as THREE from "three";
import type {
  SlugGeneratedData,
  SlugLoaderData,
  SlugGlyphStyle,
  SlugShaderEffect,
} from "../../library/index";

export type TabId = "playground" | "benchmark";
export type CameraMode = "2d" | "orbit";
export type MaterialMode = "slug" | "standard";

export type RenderSlugData = SlugLoaderData | SlugGeneratedData;

export type SceneMeshSpec = {
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
  outline?: {
    offsetX: number;
    offsetY: number;
    scale: number;
    opacity: number;
    color?: [number, number, number];
  };
};

export type BuildSceneParams = {
  sceneRoot: THREE.Group;
  loadedSlugData: RenderSlugData;
  materialMode: MaterialMode;
  lineSpacing: number;
  frameCounter: number;
  inputText: string;
  fontScale: number;
};

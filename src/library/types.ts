import type * as THREE from "three";

export interface SlugCodePointData {
  codePoint: number;
  width: number;
  height: number;
  advanceWidth: number;
  bearingX: number;
  bearingY: number;
  bandCount: number;
  bandDimX: number;
  bandDimY: number;
  bandsTexCoordX: number;
  bandsTexCoordY: number;
  texelIndex?: number;
}

export interface SlugGeneratedRawData {
  codePoints: SlugCodePointData[];
  curvesList: number[];
  bandOffsets: Uint32Array;
  curveOffsets: Uint32Array;
  metrics: {
    ascender: number;
    descender: number;
    lineGap: number;
    unitsPerEm: number;
  };
}

export interface SlugGeneratedData {
  codePoints: Map<number, SlugCodePointData>;
  curvesTex: THREE.DataTexture;
  bandsTex: THREE.DataTexture;
  ascender: number;
  descender: number;
  lineGap: number;
  unitsPerEm: number;
  _raw: SlugGeneratedRawData;
}

export interface SlugLoaderData {
  codePoints: Map<number, SlugCodePointData>;
  curvesTex: THREE.DataTexture;
  bandsTex: THREE.DataTexture;
  ascender: number;
  descender: number;
  lineGap: number;
  unitsPerEm: number;
}

export interface SlugGeneratorParameters {
  fullRange?: boolean;
  whitelist?: number[] | null;
}

export interface SlugTextOptions {
  fontScale?: number;
  lineHeight?: number;
  startX?: number;
  startY?: number;
  justify?: "left" | "center" | "right";
}

export interface SlugMaterialParameters {
  curvesTex?: THREE.DataTexture | null;
  bandsTex?: THREE.DataTexture | null;
}

import * as THREE from "three";
import type {
  SlugCodePointData,
  SlugGeneratedData,
  SlugGeneratorParameters,
} from "./types";

type OpentypeGlyph = unknown;
type OpentypeFontLike = {
  glyphs: { length: number; get: (index: number) => any };
  ascender?: number;
  descender?: number;
  lineGap?: number;
  unitsPerEm?: number;
  charToGlyph: (char: string) => OpentypeGlyph;
  getKerningValue: (
    leftGlyph: OpentypeGlyph,
    rightGlyph: OpentypeGlyph,
  ) => number;
};

const TEXTURE_WIDTH = 4096;
const SLUGGISH_HEADER_DATA = "SLUGGISH";

export class SlugGenerator {
  bandCount: number;
  fullRange: boolean;
  whitelist: number[] | null;

  constructor(parameters: SlugGeneratorParameters = {}) {
    this.bandCount = 16;
    this.fullRange =
      parameters.fullRange !== undefined ? parameters.fullRange : false;
    this.whitelist = parameters.whitelist || null;
  }

  async generateFromUrl(url: string): Promise<SlugGeneratedData> {
    const opentypeModule = await import("opentype.js");
    const opentype = (opentypeModule as any).default ?? opentypeModule;
    const font = await opentype.load(url);
    return this.generate(font);
  }

  async generateFromFile(file: File): Promise<SlugGeneratedData> {
    const buffer = await file.arrayBuffer();
    return this.generateFromBuffer(buffer);
  }

  async generateFromBuffer(buffer: ArrayBuffer): Promise<SlugGeneratedData> {
    const opentypeModule = await import("opentype.js");
    const opentype = (opentypeModule as any).default ?? opentypeModule;
    const font = opentype.parse(buffer);
    return this.generate(font);
  }

  generate(font: OpentypeFontLike): SlugGeneratedData {
    let ignoredCodePoints = 0;
    const curvesTexData: number[] = [];
    const bandsTexBandOffsets: number[] = [];
    const bandsTexCurveOffsets: number[] = [];
    const codePointsData: SlugCodePointData[] = [];

    for (let glyphIndex = 0; glyphIndex < font.glyphs.length; glyphIndex++) {
      const glyph = font.glyphs.get(glyphIndex);
      let cp = glyph.unicode;
      if (cp === undefined) {
        if (glyphIndex === 0) cp = -1;
        else continue;
      }

      if (!this.fullRange && glyphIndex !== 0) {
        if (this.whitelist) {
          if (!this.whitelist.includes(cp)) continue;
        } else if (cp < 32 || cp > 126) {
          continue;
        }
      }

      const path = glyph.path;
      const bbox = glyph.getBoundingBox();
      if (bbox.x1 === bbox.x2 || bbox.y1 === bbox.y2) {
        codePointsData.push({
          codePoint: cp,
          width: 0,
          height: 0,
          advanceWidth: Math.floor(glyph.advanceWidth || 0),
          bearingX: 0,
          bearingY: 0,
          bandCount: 0,
          bandDimX: 0,
          bandDimY: 0,
          bandsTexCoordX: 0,
          bandsTexCoordY: 0,
        });
        continue;
      }

      const gx1 = bbox.x1;
      const gy1 = bbox.y1;
      const gx2 = bbox.x2;
      const gy2 = bbox.y2;

      let curves: Array<{
        first: boolean;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        x3: number;
        y3: number;
        texelIndex?: number;
      }> | null = [];
      let currentX = 0;
      let currentY = 0;
      let firstCurve = false;
      let startOfShapeX = 0;
      let startOfShapeY = 0;

      for (
        let commandIndex = 0;
        commandIndex < path.commands.length;
        commandIndex++
      ) {
        const cmd = path.commands[commandIndex];
        if (cmd.type === "M") {
          firstCurve = true;
          currentX = cmd.x - gx1;
          currentY = cmd.y - gy1;
          startOfShapeX = currentX;
          startOfShapeY = currentY;
        } else if (cmd.type === "L") {
          const nextX = cmd.x - gx1;
          const nextY = cmd.y - gy1;
          const curve = {
            first: firstCurve,
            x1: currentX,
            y1: currentY,
            x3: nextX,
            y3: nextY,
            x2: (currentX + nextX) / 2.0,
            y2: (currentY + nextY) / 2.0,
          };
          curves.push(curve);
          firstCurve = false;
          currentX = nextX;
          currentY = nextY;
        } else if (cmd.type === "Q") {
          const nextX = cmd.x - gx1;
          const nextY = cmd.y - gy1;
          const curve = {
            first: firstCurve,
            x1: currentX,
            y1: currentY,
            x2: cmd.x1 - gx1,
            y2: cmd.y1 - gy1,
            x3: nextX,
            y3: nextY,
          };
          curves.push(curve);
          firstCurve = false;
          currentX = nextX;
          currentY = nextY;
        } else if (cmd.type === "C") {
          console.warn(
            `U+${cp.toString(16)} has bicubic curves. Slug requires quadratic.`,
          );
          ignoredCodePoints++;
          curves = null;
          break;
        } else if (cmd.type === "Z") {
          if (currentX !== startOfShapeX || currentY !== startOfShapeY) {
            const curve = {
              first: firstCurve,
              x1: currentX,
              y1: currentY,
              x3: startOfShapeX,
              y3: startOfShapeY,
              x2: (currentX + startOfShapeX) / 2.0,
              y2: (currentY + startOfShapeY) / 2.0,
            };
            curves.push(curve);
            firstCurve = false;
          }
          currentX = startOfShapeX;
          currentY = startOfShapeY;
        }
      }

      if (!curves || curves.length === 0) continue;

      for (const curve of curves) {
        if (
          (curve.x2 === curve.x1 && curve.y2 === curve.y1) ||
          (curve.x2 === curve.x3 && curve.y2 === curve.y3)
        ) {
          curve.x2 = (curve.x1 + curve.x3) / 2.0;
          curve.y2 = (curve.y1 + curve.y3) / 2.0;
        }
      }

      const bandsTexelIndex = Math.floor(bandsTexBandOffsets.length / 2);

      for (const curve of curves) {
        if (curve.first && curvesTexData.length % 4 !== 0) {
          const toAdd = 4 - (curvesTexData.length % 4);
          for (let pad = 0; pad < toAdd; pad++) curvesTexData.push(-1.0);
        }

        const texelCount = Math.floor(curvesTexData.length / 4);
        const col = texelCount % TEXTURE_WIDTH;
        const newRow = col === TEXTURE_WIDTH - 1;
        if (newRow) {
          const toAdd = 8 - (curvesTexData.length % 4);
          for (let pad = 0; pad < toAdd; pad++) curvesTexData.push(-1.0);
        }

        if (curve.first || newRow) {
          curve.texelIndex = Math.floor(curvesTexData.length / 4);
          curvesTexData.push(curve.x1, curve.y1);
        } else {
          curve.texelIndex = Math.floor(
            (Math.floor(curvesTexData.length / 2) - 1) / 2,
          );
        }

        curvesTexData.push(curve.x2, curve.y2);
        curvesTexData.push(curve.x3, curve.y3);
      }

      const sizeX = 1 + (gx2 - gx1);
      const sizeY = 1 + (gy2 - gy1);
      let bandCount = this.bandCount;
      if (sizeX < bandCount || sizeY < bandCount) {
        bandCount = Math.floor(Math.min(sizeX, sizeY) / 2);
        if (bandCount < 1) bandCount = 1;
      }

      const bandDimY = Math.ceil(sizeY / bandCount);
      let bandMinY = 0;
      let bandMaxY = bandDimY;

      curves.sort(
        (a, b) => Math.max(b.x1, b.x2, b.x3) - Math.max(a.x1, a.x2, a.x3),
      );

      for (let band = 0; band < bandCount; band++) {
        const bandTexelOffset = Math.floor(bandsTexCurveOffsets.length / 2);
        let curveCount = 0;

        for (const curve of curves) {
          if (curve.y1 === curve.y2 && curve.y2 === curve.y3) continue;
          const curveMinY = Math.min(curve.y1, curve.y2, curve.y3);
          const curveMaxY = Math.max(curve.y1, curve.y2, curve.y3);
          if (curveMinY > bandMaxY || curveMaxY < bandMinY) continue;

          const texelIndex = curve.texelIndex ?? 0;
          const curveOffsetX = texelIndex % TEXTURE_WIDTH;
          const curveOffsetY = Math.floor(texelIndex / TEXTURE_WIDTH);
          bandsTexCurveOffsets.push(curveOffsetX, curveOffsetY);
          curveCount++;
        }

        bandsTexBandOffsets.push(curveCount, bandTexelOffset);
        bandMinY += bandDimY;
        bandMaxY += bandDimY;
      }

      const bandDimX = Math.ceil(sizeX / bandCount);
      let bandMinX = 0;
      let bandMaxX = bandDimX;

      curves.sort(
        (a, b) => Math.max(b.y1, b.y2, b.y3) - Math.max(a.y1, a.y2, a.y3),
      );

      for (let band = 0; band < bandCount; band++) {
        const bandTexelOffset = Math.floor(bandsTexCurveOffsets.length / 2);
        let curveCount = 0;

        for (const curve of curves) {
          if (curve.x1 === curve.x2 && curve.x2 === curve.x3) continue;
          const curveMinX = Math.min(curve.x1, curve.x2, curve.x3);
          const curveMaxX = Math.max(curve.x1, curve.x2, curve.x3);
          if (curveMinX > bandMaxX || curveMaxX < bandMinX) continue;

          const texelIndex = curve.texelIndex ?? 0;
          const curveOffsetX = texelIndex % TEXTURE_WIDTH;
          const curveOffsetY = Math.floor(texelIndex / TEXTURE_WIDTH);
          bandsTexCurveOffsets.push(curveOffsetX, curveOffsetY);
          curveCount++;
        }

        bandsTexBandOffsets.push(curveCount, bandTexelOffset);
        bandMinX += bandDimX;
        bandMaxX += bandDimX;
      }

      codePointsData.push({
        codePoint: cp,
        width: Math.floor(gx2 - gx1),
        height: Math.floor(gy2 - gy1),
        advanceWidth: Math.floor(glyph.advanceWidth || 0),
        bearingX: Math.floor(gx1),
        bearingY: Math.floor(gy1),
        bandCount,
        bandDimX,
        bandDimY,
        bandsTexCoordX: bandsTexelIndex % TEXTURE_WIDTH,
        bandsTexCoordY: Math.floor(bandsTexelIndex / TEXTURE_WIDTH),
      });
    }

    const bandHeaderTexels = Math.floor(bandsTexBandOffsets.length / 2);
    for (let index = 1; index < bandsTexBandOffsets.length; index += 2) {
      bandsTexBandOffsets[index]! += bandHeaderTexels;
    }

    return this.buildOutput(
      codePointsData,
      curvesTexData,
      bandsTexBandOffsets,
      bandsTexCurveOffsets,
      font,
    );
  }

  buildOutput(
    codePoints: SlugCodePointData[],
    curvesList: number[],
    bandOffsets: number[],
    curveOffsets: number[],
    font: OpentypeFontLike,
  ): SlugGeneratedData {
    const map = new Map<number, SlugCodePointData>();
    codePoints.forEach((codePointData) =>
      map.set(codePointData.codePoint, codePointData),
    );

    const curvesTexels = Math.ceil(curvesList.length / 4);
    const curvesTexHeight = Math.ceil(curvesTexels / TEXTURE_WIDTH);

    const curvesFloatArray = new Float32Array(
      TEXTURE_WIDTH * curvesTexHeight * 4,
    );
    curvesFloatArray.fill(-1.0);
    curvesFloatArray.set(curvesList);

    const curvesTex = new THREE.DataTexture(
      curvesFloatArray,
      TEXTURE_WIDTH,
      curvesTexHeight,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    (curvesTex as any).internalFormat = "RGBA32F";
    curvesTex.minFilter = THREE.NearestFilter;
    curvesTex.magFilter = THREE.NearestFilter;
    curvesTex.needsUpdate = true;

    const bandsTexels =
      Math.floor(bandOffsets.length / 2) + Math.floor(curveOffsets.length / 2);
    const bandsTexHeight = Math.ceil(bandsTexels / TEXTURE_WIDTH);

    const bandsUintArray = new Uint32Array(TEXTURE_WIDTH * bandsTexHeight * 2);
    bandsUintArray.set(new Uint32Array(bandOffsets), 0);
    bandsUintArray.set(new Uint32Array(curveOffsets), bandOffsets.length);

    const bandsTex = new THREE.DataTexture(
      bandsUintArray,
      TEXTURE_WIDTH,
      bandsTexHeight,
      THREE.RGIntegerFormat,
      THREE.UnsignedIntType,
    );
    (bandsTex as any).internalFormat = "RG32UI";
    bandsTex.minFilter = THREE.NearestFilter;
    bandsTex.magFilter = THREE.NearestFilter;
    bandsTex.needsUpdate = true;

    const ascender = font.ascender || 0;
    const descender = font.descender || 0;
    const lineGap = font.lineGap || 0;
    const unitsPerEm = font.unitsPerEm || 0;

    const kerningPairs = new Map<string, number>();
    const glyphCache = new Map<number, OpentypeGlyph>();

    const getKerning = (
      leftCodePoint: number,
      rightCodePoint: number,
    ): number => {
      if (leftCodePoint < 0 || rightCodePoint < 0) return 0;

      const key = `${leftCodePoint}:${rightCodePoint}`;
      const cached = kerningPairs.get(key);
      if (cached !== undefined) return cached;

      let leftGlyph = glyphCache.get(leftCodePoint);
      if (!leftGlyph) {
        leftGlyph = font.charToGlyph(String.fromCodePoint(leftCodePoint));
        glyphCache.set(leftCodePoint, leftGlyph);
      }

      let rightGlyph = glyphCache.get(rightCodePoint);
      if (!rightGlyph) {
        rightGlyph = font.charToGlyph(String.fromCodePoint(rightCodePoint));
        glyphCache.set(rightCodePoint, rightGlyph);
      }

      const kerning = font.getKerningValue(leftGlyph, rightGlyph) || 0;
      kerningPairs.set(key, kerning);
      return kerning;
    };

    return {
      codePoints: map,
      curvesTex,
      bandsTex,
      ascender,
      descender,
      lineGap,
      unitsPerEm,
      kerningPairs,
      getKerning,
      _raw: {
        codePoints,
        curvesList,
        bandOffsets: new Uint32Array(bandOffsets),
        curveOffsets: new Uint32Array(curveOffsets),
        metrics: {
          ascender,
          descender,
          lineGap,
          unitsPerEm,
        },
      },
    };
  }

  exportSluggish(generatedData: SlugGeneratedData): ArrayBuffer {
    const { codePoints, curvesList, bandOffsets, curveOffsets } =
      generatedData._raw;

    const curvesTexels = Math.ceil(curvesList.length / 4);
    const curvesTexHeight = Math.ceil(curvesTexels / TEXTURE_WIDTH);
    const curvesFloatArray = new Float32Array(
      TEXTURE_WIDTH * curvesTexHeight * 4,
    );
    curvesFloatArray.fill(0);
    curvesFloatArray.set(curvesList);

    const bandsTexels =
      Math.floor(bandOffsets.length / 2) + Math.floor(curveOffsets.length / 2);
    const bandsTexHeight = Math.ceil(bandsTexels / TEXTURE_WIDTH);
    const bandsUintArray = new Uint32Array(TEXTURE_WIDTH * bandsTexHeight * 2);
    bandsUintArray.set(bandOffsets, 0);
    bandsUintArray.set(curveOffsets, bandOffsets.length);

    const curvesBytes = curvesFloatArray.byteLength;
    const bandsBytes = bandsUintArray.byteLength;
    const metrics = generatedData._raw.metrics || {
      ascender: 0,
      descender: 0,
      lineGap: 0,
      unitsPerEm: 0,
    };

    const totalBytes =
      8 + 2 + codePoints.length * 40 + 8 + curvesBytes + 8 + bandsBytes + 16;
    const buffer = new ArrayBuffer(totalBytes);
    const view = new DataView(buffer);
    let offset = 0;

    for (let i = 0; i < 8; i++) {
      view.setUint8(offset++, SLUGGISH_HEADER_DATA.charCodeAt(i));
    }

    view.setUint16(offset, codePoints.length, true);
    offset += 2;

    for (const codePointData of codePoints) {
      view.setUint32(offset, codePointData.codePoint, true);
      offset += 4;
      view.setUint32(offset, codePointData.width, true);
      offset += 4;
      view.setUint32(offset, codePointData.height, true);
      offset += 4;
      view.setUint32(offset, codePointData.advanceWidth, true);
      offset += 4;
      view.setInt32(offset, codePointData.bearingX, true);
      offset += 4;
      view.setInt32(offset, codePointData.bearingY, true);
      offset += 4;
      view.setUint32(offset, codePointData.bandCount, true);
      offset += 4;
      view.setUint32(offset, codePointData.bandDimX, true);
      offset += 4;
      view.setUint32(offset, codePointData.bandDimY, true);
      offset += 4;
      view.setUint16(offset, codePointData.bandsTexCoordX, true);
      offset += 2;
      view.setUint16(offset, codePointData.bandsTexCoordY, true);
      offset += 2;
    }

    view.setUint16(offset, TEXTURE_WIDTH, true);
    offset += 2;
    view.setUint16(offset, curvesTexHeight, true);
    offset += 2;
    view.setUint32(offset, curvesBytes, true);
    offset += 4;
    new Uint8Array(buffer).set(new Uint8Array(curvesFloatArray.buffer), offset);
    offset += curvesBytes;

    view.setUint16(offset, TEXTURE_WIDTH, true);
    offset += 2;
    view.setUint16(offset, bandsTexHeight, true);
    offset += 2;
    view.setUint32(offset, bandsBytes, true);
    offset += 4;
    new Uint8Array(buffer).set(new Uint8Array(bandsUintArray.buffer), offset);
    offset += bandsBytes;

    view.setInt32(offset, metrics.ascender || 0, true);
    offset += 4;
    view.setInt32(offset, metrics.descender || 0, true);
    offset += 4;
    view.setInt32(offset, metrics.lineGap || 0, true);
    offset += 4;
    view.setInt32(offset, metrics.unitsPerEm || 0, true);
    offset += 4;

    return buffer;
  }
}

import * as THREE from 'three';
import type { SlugLoaderData } from './types';

const SLUGGISH_HEADER_DATA = 'SLUGGISH';
const TEXTURE_WIDTH = 4096;

type ParsedCodePoint = {
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
};

export class SlugLoader {
  manager: THREE.LoadingManager;

  constructor(manager?: THREE.LoadingManager) {
    this.manager = manager !== undefined ? manager : THREE.DefaultLoadingManager;
  }

  load(
    url: string,
    onLoad: (data: SlugLoaderData) => void,
    onProgress?: (event: ProgressEvent<EventTarget>) => void,
    onError?: (error: unknown) => void,
  ): void {
    const loader = new THREE.FileLoader(this.manager);
    loader.setResponseType('arraybuffer');
    loader.load(
      url,
      (buffer) => {
        try {
          onLoad(this.parse(buffer as ArrayBuffer));
        } catch (error) {
          if (onError) onError(error);
          else console.error(error);
        }
      },
      onProgress,
      onError,
    );
  }

  parse(buffer: ArrayBuffer): SlugLoaderData {
    const dataView = new DataView(buffer);
    let offset = 0;

    const headerBytes = new Uint8Array(buffer, offset, 8);
    const headerStr = String.fromCharCode(...headerBytes);
    if (headerStr !== SLUGGISH_HEADER_DATA) {
      throw new Error(`Invalid header found (${headerStr} instead of ${SLUGGISH_HEADER_DATA})`);
    }
    offset += 8;

    const codePointCount = dataView.getUint16(offset, true);
    offset += 2;

    const codePoints = new Map<number, ParsedCodePoint>();

    const cpTableStart = offset;
    const cpTable40End = cpTableStart + codePointCount * 40;
    const cpTable28End = cpTableStart + codePointCount * 28;

    const looksLikeTextureHeaderAt = (tableEndOffset: number): boolean => {
      if (tableEndOffset + 8 > buffer.byteLength) return false;
      const width = dataView.getUint16(tableEndOffset, true);
      const height = dataView.getUint16(tableEndOffset + 2, true);
      const bytes = dataView.getUint32(tableEndOffset + 4, true);
      if (width !== TEXTURE_WIDTH || height === 0 || bytes === 0) return false;
      return tableEndOffset + 8 + bytes <= buffer.byteLength;
    };

    const useExtended40 = looksLikeTextureHeaderAt(cpTable40End);
    const useCompact28 = !useExtended40 && looksLikeTextureHeaderAt(cpTable28End);

    if (!useExtended40 && !useCompact28) {
      throw new Error('Unsupported codepoint table layout in sluggish file');
    }

    if (useExtended40) {
      for (let index = 0; index < codePointCount; index++) {
        const cp = {
          codePoint: dataView.getUint32(offset, true),
          width: dataView.getUint32(offset + 4, true),
          height: dataView.getUint32(offset + 8, true),
          advanceWidth: dataView.getUint32(offset + 12, true),
          bearingX: dataView.getInt32(offset + 16, true),
          bearingY: dataView.getInt32(offset + 20, true),
          bandCount: dataView.getUint32(offset + 24, true),
          bandDimX: dataView.getUint32(offset + 28, true),
          bandDimY: dataView.getUint32(offset + 32, true),
          bandsTexCoordX: dataView.getUint16(offset + 36, true),
          bandsTexCoordY: dataView.getUint16(offset + 38, true),
        };
        codePoints.set(cp.codePoint, cp);
        offset += 40;
      }
    } else {
      const compactRecords: Array<{
        codePoint: number;
        width: number;
        height: number;
        advanceWidth: number;
        bearingX: number;
        bearingY: number;
        bandTexelIndex: number;
      }> = [];

      for (let index = 0; index < codePointCount; index++) {
        compactRecords.push({
          codePoint: dataView.getUint32(offset, true),
          width: dataView.getUint32(offset + 4, true),
          height: dataView.getUint32(offset + 8, true),
          advanceWidth: dataView.getUint32(offset + 12, true),
          bearingX: dataView.getInt32(offset + 16, true),
          bearingY: dataView.getInt32(offset + 20, true),
          bandTexelIndex: dataView.getUint32(offset + 24, true),
        });
        offset += 28;
      }

      for (let index = 0; index < compactRecords.length; index++) {
        const record = compactRecords[index];
        let bandCount = 16;

        if (index < compactRecords.length - 1) {
          const delta = compactRecords[index + 1].bandTexelIndex - record.bandTexelIndex;
          if (delta > 0 && delta % 2 === 0) {
            bandCount = Math.max(1, delta / 2);
          }
        } else if (compactRecords.length > 1) {
          const prev = compactRecords[index - 1];
          const delta = record.bandTexelIndex - prev.bandTexelIndex;
          if (delta > 0 && delta % 2 === 0) {
            bandCount = Math.max(1, delta / 2);
          }
        }

        const sizeX = 1 + record.width;
        const sizeY = 1 + record.height;
        const bandDimX = Math.ceil(sizeX / bandCount);
        const bandDimY = Math.ceil(sizeY / bandCount);

        codePoints.set(record.codePoint, {
          codePoint: record.codePoint,
          width: record.width,
          height: record.height,
          advanceWidth: record.advanceWidth,
          bearingX: record.bearingX,
          bearingY: record.bearingY,
          bandCount,
          bandDimX,
          bandDimY,
          bandsTexCoordX: record.bandTexelIndex % TEXTURE_WIDTH,
          bandsTexCoordY: Math.floor(record.bandTexelIndex / TEXTURE_WIDTH),
        });
      }
    }

    const curvesTexWidth = dataView.getUint16(offset, true);
    offset += 2;
    const curvesTexHeight = dataView.getUint16(offset, true);
    offset += 2;
    const curvesTexBytes = dataView.getUint32(offset, true);
    offset += 4;

    if (curvesTexWidth === 0 || curvesTexHeight === 0 || curvesTexBytes === 0 || curvesTexWidth !== TEXTURE_WIDTH) {
      throw new Error('Invalid curves texture dimensions');
    }

    const curvesTexels = curvesTexWidth * curvesTexHeight;
    const curvesData = new Float32Array(curvesTexels * 4);
    const curvesBuffer = buffer.slice(offset, offset + curvesTexBytes);
    curvesData.set(new Float32Array(curvesBuffer));
    offset += curvesTexBytes;

    const bandsTexWidth = dataView.getUint16(offset, true);
    offset += 2;
    const bandsTexHeight = dataView.getUint16(offset, true);
    offset += 2;
    const bandsTexBytes = dataView.getUint32(offset, true);
    offset += 4;

    if (bandsTexWidth === 0 || bandsTexHeight === 0 || bandsTexBytes === 0 || bandsTexWidth !== TEXTURE_WIDTH) {
      throw new Error('Invalid bands texture dimensions');
    }

    const bandsTexels = bandsTexWidth * bandsTexHeight;
    const bandsData = new Uint32Array(bandsTexels * 2);
    const bandsBuffer = buffer.slice(offset, offset + bandsTexBytes);
    bandsData.set(new Uint32Array(bandsBuffer));
    offset += bandsTexBytes;

    let ascender = 0;
    let descender = 0;
    let lineGap = 0;
    let unitsPerEm = 0;
    if (offset + 16 <= buffer.byteLength) {
      ascender = dataView.getInt32(offset, true);
      offset += 4;
      descender = dataView.getInt32(offset, true);
      offset += 4;
      lineGap = dataView.getInt32(offset, true);
      offset += 4;
      unitsPerEm = dataView.getInt32(offset, true);
      offset += 4;
    }

    const curvesTex = new THREE.DataTexture(curvesData, curvesTexWidth, curvesTexHeight, THREE.RGBAFormat, THREE.FloatType);
    (curvesTex as any).internalFormat = 'RGBA32F';
    curvesTex.minFilter = THREE.NearestFilter;
    curvesTex.magFilter = THREE.NearestFilter;
    curvesTex.needsUpdate = true;

    const bandsTex = new THREE.DataTexture(bandsData, bandsTexWidth, bandsTexHeight, THREE.RGIntegerFormat, THREE.UnsignedIntType);
    (bandsTex as any).internalFormat = 'RG32UI';
    bandsTex.minFilter = THREE.NearestFilter;
    bandsTex.magFilter = THREE.NearestFilter;
    bandsTex.needsUpdate = true;

    return {
      codePoints,
      curvesTex,
      bandsTex,
      ascender,
      descender,
      lineGap,
      unitsPerEm,
    };
  }
}

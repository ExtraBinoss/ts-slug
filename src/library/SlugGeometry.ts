import * as THREE from "three";
import type {
  SlugCodePointData,
  SlugTextOptions,
  SlugLoaderData,
} from "./types";

export class SlugGeometry extends THREE.InstancedBufferGeometry {
  maxGlyphs: number;
  glyphCount: number;
  aScaleBias: Float32Array;
  aGlyphBandScale: Float32Array;
  aBandMaxTexCoords: Float32Array;

  constructor(maxGlyphs = 1024) {
    super();

    const vertices = new Float32Array([
      -1.0, -1.0, -1.0, 1.0, 1.0, 1.0, 1.0, -1.0,
    ]);

    const uvs = new Float32Array([0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0]);

    const normals = new Float32Array([
      0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
    ]);

    const indices = new Uint16Array([0, 2, 1, 0, 3, 2]);

    this.setIndex(new THREE.BufferAttribute(indices, 1));
    this.setAttribute("position", new THREE.BufferAttribute(vertices, 2));
    this.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    this.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

    this.maxGlyphs = maxGlyphs;
    this.glyphCount = 0;

    this.aScaleBias = new Float32Array(maxGlyphs * 4);
    this.aGlyphBandScale = new Float32Array(maxGlyphs * 4);
    this.aBandMaxTexCoords = new Float32Array(maxGlyphs * 4);

    const attrScaleBias = new THREE.InstancedBufferAttribute(
      this.aScaleBias,
      4,
    );
    attrScaleBias.setUsage(THREE.DynamicDrawUsage);
    this.setAttribute("aScaleBias", attrScaleBias);

    const attrGlyphBandScale = new THREE.InstancedBufferAttribute(
      this.aGlyphBandScale,
      4,
    );
    attrGlyphBandScale.setUsage(THREE.DynamicDrawUsage);
    this.setAttribute("aGlyphBandScale", attrGlyphBandScale);

    const attrBandMaxTexCoords = new THREE.InstancedBufferAttribute(
      this.aBandMaxTexCoords,
      4,
    );
    attrBandMaxTexCoords.setUsage(THREE.DynamicDrawUsage);
    this.setAttribute("aBandMaxTexCoords", attrBandMaxTexCoords);

    this.instanceCount = 0;
    this.boundingBox = new THREE.Box3();
    this.boundingSphere = new THREE.Sphere();
  }

  clear(): void {
    this.glyphCount = 0;
    this.instanceCount = 0;
    if (this.boundingBox) this.boundingBox.makeEmpty();
    if (this.boundingSphere) this.boundingSphere.radius = 0;
  }

  computeBoundingSphere(): void {
    if (!this.boundingBox || this.boundingBox.isEmpty()) {
      this.boundingSphere!.set(new THREE.Vector3(), 0);
    } else {
      this.boundingBox.getBoundingSphere(this.boundingSphere!);
    }
  }

  addGlyph(
    codePointData: SlugCodePointData,
    x: number,
    y: number,
    width: number,
    height: number,
    _displayWidth: number,
    _displayHeight: number,
  ): boolean {
    if (this.glyphCount >= this.maxGlyphs) {
      console.warn("Max glyphs reached");
      return false;
    }

    const index = this.glyphCount;
    const sx = width / 2.0;
    const sy = height / 2.0;
    const cx = x + sx;
    const cy = y + sy;

    this.aScaleBias[index * 4 + 0] = sx;
    this.aScaleBias[index * 4 + 1] = sy;
    this.aScaleBias[index * 4 + 2] = cx;
    this.aScaleBias[index * 4 + 3] = cy;

    this.boundingBox!.expandByPoint(new THREE.Vector3(cx - sx, cy - sy, 0));
    this.boundingBox!.expandByPoint(new THREE.Vector3(cx + sx, cy + sy, 0));

    this.aGlyphBandScale[index * 4 + 0] = codePointData.width;
    this.aGlyphBandScale[index * 4 + 1] = codePointData.height;
    this.aGlyphBandScale[index * 4 + 2] =
      codePointData.bandDimX === 0
        ? 0
        : codePointData.width / codePointData.bandDimX;
    this.aGlyphBandScale[index * 4 + 3] =
      codePointData.bandDimY === 0
        ? 0
        : codePointData.height / codePointData.bandDimY;

    this.aBandMaxTexCoords[index * 4 + 0] = codePointData.bandCount - 1;
    this.aBandMaxTexCoords[index * 4 + 1] = codePointData.bandCount - 1;
    this.aBandMaxTexCoords[index * 4 + 2] = codePointData.bandsTexCoordX;
    this.aBandMaxTexCoords[index * 4 + 3] = codePointData.bandsTexCoordY;

    this.glyphCount++;
    this.instanceCount = this.glyphCount;

    return true;
  }

  updateBuffers(): void {
    (this.attributes as any).aScaleBias.needsUpdate = true;
    (this.attributes as any).aGlyphBandScale.needsUpdate = true;
    (this.attributes as any).aBandMaxTexCoords.needsUpdate = true;
    this.computeBoundingSphere();
  }

  private getKerningAdjustment(
    slugData: SlugLoaderData,
    leftCodePoint: number,
    rightCodePoint: number,
  ): number {
    if (leftCodePoint < 0 || rightCodePoint < 0) return 0;

    if (slugData.getKerning) {
      return slugData.getKerning(leftCodePoint, rightCodePoint) || 0;
    }

    if (slugData.kerningPairs) {
      return slugData.kerningPairs.get(`${leftCodePoint}:${rightCodePoint}`) || 0;
    }

    return 0;
  }

  addText(
    text: string,
    slugData: SlugLoaderData,
    options: SlugTextOptions = {},
  ): void {
    const ascender = slugData.ascender || 0;
    const descender = slugData.descender || 0;
    const lineGap = slugData.lineGap || 0;

    const defaultLineHeight =
      slugData.unitsPerEm > 0 ? ascender - descender + lineGap : 2000;
    const {
      fontScale = 0.5,
      lineHeight = defaultLineHeight * fontScale,
      startX = 0,
      startY = 0,
      justify = "left",
    } = options;

    const lines = text.split("\n");
    let currentY = startY;

    for (const line of lines) {
      let lineWidth = 0;
      let previousCodePoint: number | null = null;

      let cursor = 0;
      while (cursor < line.length) {
        const charCode = line.codePointAt(cursor) ?? 0;
        cursor += charCode > 0xffff ? 2 : 1;
        const data =
          slugData.codePoints.get(charCode) || slugData.codePoints.get(-1);

        const kerning =
          previousCodePoint === null
            ? 0
            : this.getKerningAdjustment(slugData, previousCodePoint, charCode);

        if (data) {
          lineWidth += (kerning + data.advanceWidth) * fontScale;
        } else if (line[cursor - 1] === " ") {
          lineWidth += (kerning + 600) * fontScale;
        }

        previousCodePoint = charCode;
      }

      let currentX = startX;
      if (justify === "center") currentX -= lineWidth / 2.0;
      else if (justify === "right") currentX -= lineWidth;

      let index = 0;
      previousCodePoint = null;
      while (index < line.length) {
        const charCode = line.codePointAt(index) ?? 0;
        index += charCode > 0xffff ? 2 : 1;
        const data =
          slugData.codePoints.get(charCode) || slugData.codePoints.get(-1);

        const kerning =
          previousCodePoint === null
            ? 0
            : this.getKerningAdjustment(slugData, previousCodePoint, charCode);

        currentX += kerning * fontScale;

        if (data) {
          if (data.width > 0 && data.height > 0) {
            const quadW = data.width * fontScale;
            const quadH = data.height * fontScale;
            const px = currentX + data.bearingX * fontScale;
            const py = currentY + data.bearingY * fontScale;
            this.addGlyph(data, px, py, quadW, quadH, 0, 0);
          }
          currentX += data.advanceWidth * fontScale;
        } else if (line[index - 1] === " ") {
          currentX += 600 * fontScale;
        }

        previousCodePoint = charCode;
      }

      currentY -= lineHeight;
    }

    this.updateBuffers();
  }
}

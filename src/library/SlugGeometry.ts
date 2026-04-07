import * as THREE from "three";
import type {
  SlugCodePointData,
  SlugGlyphStyle,
  SlugGlyphStyleResolver,
  SlugLoaderData,
  SlugTextOptions,
} from "./types";

export class SlugGeometry extends THREE.InstancedBufferGeometry {
  maxGlyphs: number;
  glyphCount: number;
  aScaleBias: Float32Array;
  aGlyphBandScale: Float32Array;
  aBandMaxTexCoords: Float32Array;
  aGlyphColor: Float32Array;
  aGlyphParams: Float32Array;

  constructor(maxGlyphs?: number) {
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

    const initialCapacity = maxGlyphs ?? 256;
    this.maxGlyphs = Math.max(1, Math.floor(initialCapacity));
    this.glyphCount = 0;

    this.aScaleBias = new Float32Array(this.maxGlyphs * 4);
    this.aGlyphBandScale = new Float32Array(this.maxGlyphs * 4);
    this.aBandMaxTexCoords = new Float32Array(this.maxGlyphs * 4);
    this.aGlyphColor = new Float32Array(this.maxGlyphs * 4);
    this.aGlyphParams = new Float32Array(this.maxGlyphs * 4);

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

    const attrGlyphColor = new THREE.InstancedBufferAttribute(
      this.aGlyphColor,
      4,
    );
    attrGlyphColor.setUsage(THREE.DynamicDrawUsage);
    this.setAttribute("aGlyphColor", attrGlyphColor);

    const attrGlyphParams = new THREE.InstancedBufferAttribute(
      this.aGlyphParams,
      4,
    );
    attrGlyphParams.setUsage(THREE.DynamicDrawUsage);
    this.setAttribute("aGlyphParams", attrGlyphParams);

    this.instanceCount = 0;
    this.boundingBox = new THREE.Box3();
    this.boundingSphere = new THREE.Sphere();
  }

  private setInstancedAttribute(name: string, array: Float32Array): void {
    const attribute = new THREE.InstancedBufferAttribute(array, 4);
    attribute.setUsage(THREE.DynamicDrawUsage);
    this.setAttribute(name, attribute);
  }

  private resizeCapacity(newCapacity: number): void {
    const targetCapacity = Math.max(
      this.maxGlyphs + 1,
      Math.floor(newCapacity),
    );
    if (targetCapacity <= this.maxGlyphs) return;

    const copyLength = this.glyphCount * 4;

    const nextScaleBias = new Float32Array(targetCapacity * 4);
    nextScaleBias.set(this.aScaleBias.subarray(0, copyLength));
    this.aScaleBias = nextScaleBias;

    const nextGlyphBandScale = new Float32Array(targetCapacity * 4);
    nextGlyphBandScale.set(this.aGlyphBandScale.subarray(0, copyLength));
    this.aGlyphBandScale = nextGlyphBandScale;

    const nextBandMaxTexCoords = new Float32Array(targetCapacity * 4);
    nextBandMaxTexCoords.set(this.aBandMaxTexCoords.subarray(0, copyLength));
    this.aBandMaxTexCoords = nextBandMaxTexCoords;

    const nextGlyphColor = new Float32Array(targetCapacity * 4);
    nextGlyphColor.set(this.aGlyphColor.subarray(0, copyLength));
    this.aGlyphColor = nextGlyphColor;

    const nextGlyphParams = new Float32Array(targetCapacity * 4);
    nextGlyphParams.set(this.aGlyphParams.subarray(0, copyLength));
    this.aGlyphParams = nextGlyphParams;

    this.setInstancedAttribute("aScaleBias", this.aScaleBias);
    this.setInstancedAttribute("aGlyphBandScale", this.aGlyphBandScale);
    this.setInstancedAttribute("aBandMaxTexCoords", this.aBandMaxTexCoords);
    this.setInstancedAttribute("aGlyphColor", this.aGlyphColor);
    this.setInstancedAttribute("aGlyphParams", this.aGlyphParams);

    this.maxGlyphs = targetCapacity;
  }

  private ensureCapacityForRequestedCharacters(
    requestedCharacters: number,
  ): void {
    const requested = Math.max(1, Math.ceil(requestedCharacters));
    const target = this.glyphCount + Math.ceil(requested * 1.05);
    if (target > this.maxGlyphs) {
      this.resizeCapacity(target);
    }
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
    style?: SlugGlyphStyle | null,
  ): boolean {
    if (this.glyphCount >= this.maxGlyphs) {
      const growBy = Math.max(1, Math.ceil(this.maxGlyphs * 0.05));
      this.resizeCapacity(this.maxGlyphs + growBy);
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

    const color = style?.color || [1, 1, 1, 1];
    const params = style?.params || [0, 0, 0, 0];
    this.aGlyphColor[index * 4 + 0] = color[0];
    this.aGlyphColor[index * 4 + 1] = color[1];
    this.aGlyphColor[index * 4 + 2] = color[2];
    this.aGlyphColor[index * 4 + 3] = color[3];
    this.aGlyphParams[index * 4 + 0] = params[0];
    this.aGlyphParams[index * 4 + 1] = params[1];
    this.aGlyphParams[index * 4 + 2] = params[2];
    this.aGlyphParams[index * 4 + 3] = params[3];

    this.glyphCount++;
    this.instanceCount = this.glyphCount;

    return true;
  }

  updateBuffers(): void {
    (this.attributes as any).aScaleBias.needsUpdate = true;
    (this.attributes as any).aGlyphBandScale.needsUpdate = true;
    (this.attributes as any).aBandMaxTexCoords.needsUpdate = true;
    (this.attributes as any).aGlyphColor.needsUpdate = true;
    (this.attributes as any).aGlyphParams.needsUpdate = true;
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
      return (
        slugData.kerningPairs.get(`${leftCodePoint}:${rightCodePoint}`) || 0
      );
    }

    return 0;
  }

  private computeAdvanceWidth(
    slugData: SlugLoaderData,
    text: string,
    fontScale: number,
  ): number {
    let width = 0;
    let previousCodePoint: number | null = null;
    let index = 0;

    while (index < text.length) {
      const charCode = text.codePointAt(index) ?? 0;
      index += charCode > 0xffff ? 2 : 1;
      const data =
        slugData.codePoints.get(charCode) || slugData.codePoints.get(-1);
      const kerning =
        previousCodePoint === null
          ? 0
          : this.getKerningAdjustment(slugData, previousCodePoint, charCode);

      if (data) {
        width += (kerning + data.advanceWidth) * fontScale;
      } else if (text[index - 1] === " ") {
        width += (kerning + 600) * fontScale;
      }

      previousCodePoint = charCode;
    }

    return width;
  }

  private wrapLine(
    line: string,
    slugData: SlugLoaderData,
    fontScale: number,
    maxWidth: number,
    wrapMode: "word" | "char",
  ): string[] {
    if (maxWidth <= 0) return [line];

    if (wrapMode === "char") {
      const wrappedLines: string[] = [];
      let currentLine = "";
      let currentWidth = 0;

      for (const char of Array.from(line)) {
        const charWidth = this.computeAdvanceWidth(slugData, char, fontScale);
        if (currentLine.length > 0 && currentWidth + charWidth > maxWidth) {
          wrappedLines.push(currentLine);
          currentLine = char;
          currentWidth = charWidth;
        } else {
          currentLine += char;
          currentWidth += charWidth;
        }
      }

      if (currentLine.length > 0) wrappedLines.push(currentLine);
      return wrappedLines.length > 0 ? wrappedLines : [""];
    }

    const tokens = line.match(/\S+|\s+/g) || [""];
    const wrappedLines: string[] = [];
    let currentLine = "";
    let currentWidth = 0;

    for (const token of tokens) {
      const tokenWidth = this.computeAdvanceWidth(slugData, token, fontScale);
      const trimmedToken = token.trim();
      const isWhitespace = trimmedToken.length === 0;

      if (
        currentLine.length > 0 &&
        currentWidth + tokenWidth > maxWidth &&
        !isWhitespace
      ) {
        wrappedLines.push(currentLine.trimEnd());
        currentLine = token.trimStart();
        currentWidth = this.computeAdvanceWidth(
          slugData,
          currentLine,
          fontScale,
        );
        continue;
      }

      currentLine += token;
      currentWidth += tokenWidth;
    }

    if (currentLine.trim().length > 0) wrappedLines.push(currentLine.trimEnd());
    return wrappedLines.length > 0 ? wrappedLines : [""];
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
      maxWidth = 0,
      wrap = false,
      wrapMode = "word",
      glyphStyle,
    } = options;

    const lines = text.split("\n");
    let currentY = startY;

    const resolveStyle = (
      codePoint: number,
      lineIndex: number,
      glyphIndex: number,
      line: string,
    ): SlugGlyphStyle | null => {
      if (!glyphStyle) return null;
      if (typeof glyphStyle === "function") {
        return (
          (glyphStyle as SlugGlyphStyleResolver)(
            codePoint,
            lineIndex,
            glyphIndex,
            line,
          ) || null
        );
      }
      return glyphStyle;
    };

    const layoutLines: Array<{ text: string; sourceLineIndex: number }> = [];
    lines.forEach((line, lineIndex) => {
      if (wrap || maxWidth > 0) {
        const wrapped = this.wrapLine(
          line,
          slugData,
          fontScale,
          maxWidth,
          wrapMode,
        );
        wrapped.forEach((wrappedLine) =>
          layoutLines.push({ text: wrappedLine, sourceLineIndex: lineIndex }),
        );
      } else {
        layoutLines.push({ text: line, sourceLineIndex: lineIndex });
      }
    });

    const requestedCharacters = layoutLines.reduce((sum, { text: line }) => {
      return sum + Array.from(line).length;
    }, 0);
    this.ensureCapacityForRequestedCharacters(requestedCharacters);

    layoutLines.forEach(({ text: line, sourceLineIndex: lineIndex }) => {
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
      let glyphIndex = 0;
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
            this.addGlyph(
              data,
              px,
              py,
              quadW,
              quadH,
              0,
              0,
              resolveStyle(charCode, lineIndex, glyphIndex, line),
            );
          }
          currentX += data.advanceWidth * fontScale;
        } else if (line[index - 1] === " ") {
          currentX += 600 * fontScale;
        }

        previousCodePoint = charCode;
        glyphIndex++;
      }

      currentY -= lineHeight;
    });

    this.updateBuffers();
  }
}

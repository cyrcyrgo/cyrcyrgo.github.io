/**
 * GlobalDisplayAPI - Unified display API for the WebNT-HTML5 Web OS Kernel.
 * ALL UI rendering MUST go through this singleton.
 */

export const layerTypes = {
  BACKGROUND: 0,
  DESKTOP: 1,
  WINDOW: 2,
  OVERLAY: 3,
  CURSOR: 4,
  DEBUG: 5,
} as const;

export type LayerType = (typeof layerTypes)[keyof typeof layerTypes];

interface LayerInfo {
  id: string;
  type: LayerType;
  name: string;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  zIndex: number;
  visible: boolean;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DisplayOptions {
  width?: number;
  height?: number;
  devicePixelRatio?: number;
  debug?: boolean;
}

interface DisplayStats {
  totalLayers: number;
  visibleLayers: number;
  frameCount: number;
  lastCompositeTime: number;
  layersByType: Record<string, number>;
}

let _instance: GlobalDisplayAPI | null = null;

export class GlobalDisplayAPI {
  private layers: Map<string, LayerInfo> = new Map();
  private layerOrder: string[] = [];
  private mainCanvas: HTMLCanvasElement | null = null;
  private mainCtx: CanvasRenderingContext2D | null = null;
  private width: number = 1920;
  private height: number = 1080;
  private devicePixelRatio: number = 1;
  private debug: boolean = false;
  private frameCount: number = 0;
  private lastCompositeTime: number = 0;
  private idCounter: number = 0;
  private initialized: boolean = false;

  static get instance(): GlobalDisplayAPI {
    if (!_instance) {
      _instance = new GlobalDisplayAPI();
    }
    return _instance;
  }

  private constructor() {}

  private generateId(): string {
    this.idCounter++;
    return `layer_${Date.now()}_${this.idCounter}`;
  }

  initialize(mainCanvas: HTMLCanvasElement, options: DisplayOptions = {}): void {
    this.mainCanvas = mainCanvas;
    const ctx = mainCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('GlobalDisplayAPI: Failed to get 2D context from main canvas');
    }
    this.mainCtx = ctx;
    this.width = options.width ?? mainCanvas.width;
    this.height = options.height ?? mainCanvas.height;
    this.devicePixelRatio = options.devicePixelRatio ?? window.devicePixelRatio ?? 1;
    this.debug = options.debug ?? false;

    mainCanvas.width = this.width * this.devicePixelRatio;
    mainCanvas.height = this.height * this.devicePixelRatio;
    mainCanvas.style.width = `${this.width}px`;
    mainCanvas.style.height = `${this.height}px`;
    this.mainCtx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);

    this.initialized = true;
  }

  createLayer(type: LayerType, name: string, width: number, height: number): string {
    this.ensureInitialized();
    const id = this.generateId();
    const canvas = new OffscreenCanvas(
      width * this.devicePixelRatio,
      height * this.devicePixelRatio
    );
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('GlobalDisplayAPI: Failed to get 2D context for layer');
    }
    ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);

    const layer: LayerInfo = {
      id,
      type,
      name,
      canvas,
      ctx,
      zIndex: this.layerOrder.length,
      visible: true,
      opacity: 1.0,
      x: 0,
      y: 0,
      width,
      height,
    };

    this.layers.set(id, layer);
    this.layerOrder.push(id);
    return id;
  }

  removeLayer(layerId: string): void {
    this.ensureInitialized();
    const layer = this.layers.get(layerId);
    if (!layer) {
      console.warn(`GlobalDisplayAPI: Layer ${layerId} not found`);
      return;
    }
    this.layers.delete(layerId);
    this.layerOrder = this.layerOrder.filter((id) => id !== layerId);
  }

  setLayerOrder(layerId: string, zIndex: number): void {
    this.ensureInitialized();
    const layer = this.layers.get(layerId);
    if (!layer) {
      console.warn(`GlobalDisplayAPI: Layer ${layerId} not found`);
      return;
    }
    layer.zIndex = zIndex;
    this.sortLayers();
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    this.ensureInitialized();
    const layer = this.layers.get(layerId);
    if (!layer) {
      console.warn(`GlobalDisplayAPI: Layer ${layerId} not found`);
      return;
    }
    layer.visible = visible;
  }

  setLayerOpacity(layerId: string, opacity: number): void {
    this.ensureInitialized();
    const layer = this.layers.get(layerId);
    if (!layer) {
      console.warn(`GlobalDisplayAPI: Layer ${layerId} not found`);
      return;
    }
    layer.opacity = Math.max(0, Math.min(1, opacity));
  }

  setLayerPosition(layerId: string, x: number, y: number): void {
    this.ensureInitialized();
    const layer = this.layers.get(layerId);
    if (!layer) {
      console.warn(`GlobalDisplayAPI: Layer ${layerId} not found`);
      return;
    }
    layer.x = x;
    layer.y = y;
  }

  resizeLayer(layerId: string, width: number, height: number): void {
    this.ensureInitialized();
    const layer = this.layers.get(layerId);
    if (!layer) {
      console.warn(`GlobalDisplayAPI: Layer ${layerId} not found`);
      return;
    }
    const newCanvas = new OffscreenCanvas(
      width * this.devicePixelRatio,
      height * this.devicePixelRatio
    );
    const newCtx = newCanvas.getContext('2d');
    if (!newCtx) {
      throw new Error('GlobalDisplayAPI: Failed to get 2D context for resized layer');
    }
    newCtx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);
    newCtx.drawImage(layer.canvas, 0, 0);

    layer.canvas = newCanvas;
    layer.ctx = newCtx;
    layer.width = width;
    layer.height = height;
  }

  getLayerCanvas(layerId: string): OffscreenCanvas | null {
    const layer = this.layers.get(layerId);
    return layer ? layer.canvas : null;
  }

  compositeToScreen(mainCanvas?: HTMLCanvasElement): void {
    this.ensureInitialized();
    const canvas = mainCanvas ?? this.mainCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const startTime = performance.now();

    ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    const sorted = this.getSortedLayers();

    for (const layer of sorted) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(
        layer.canvas,
        0,
        0,
        layer.width * this.devicePixelRatio,
        layer.height * this.devicePixelRatio,
        layer.x,
        layer.y,
        layer.width,
        layer.height
      );
    }

    ctx.globalAlpha = 1.0;
    this.frameCount++;
    this.lastCompositeTime = performance.now() - startTime;
  }

  drawRect(layerId: string, x: number, y: number, w: number, h: number, color: string): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    layer.ctx.fillStyle = color;
    layer.ctx.fillRect(x, y, w, h);
  }

  strokeRect(
    layerId: string,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    lineWidth: number = 1
  ): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    layer.ctx.strokeStyle = color;
    layer.ctx.lineWidth = lineWidth;
    layer.ctx.strokeRect(x, y, w, h);
  }

  drawText(
    layerId: string,
    text: string,
    x: number,
    y: number,
    font: string,
    color: string
  ): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    layer.ctx.font = font;
    layer.ctx.fillStyle = color;
    layer.ctx.fillText(text, x, y);
  }

  drawImage(
    layerId: string,
    image: CanvasImageSource,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    layer.ctx.drawImage(image, x, y, w, h);
  }

  clearLayer(layerId: string): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    layer.ctx.clearRect(0, 0, layer.width, layer.height);
  }

  getStats(): DisplayStats {
    const layersByType: Record<string, number> = {};
    let visibleLayers = 0;
    for (const layer of this.layers.values()) {
      const typeName = Object.keys(layerTypes).find(
        (k) => layerTypes[k as keyof typeof layerTypes] === layer.type
      ) ?? 'UNKNOWN';
      layersByType[typeName] = (layersByType[typeName] ?? 0) + 1;
      if (layer.visible) visibleLayers++;
    }
    return {
      totalLayers: this.layers.size,
      visibleLayers,
      frameCount: this.frameCount,
      lastCompositeTime: this.lastCompositeTime,
      layersByType,
    };
  }

  getLayerInfo(layerId: string): LayerInfo | null {
    return this.layers.get(layerId) ?? null;
  }

  getDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  private sortLayers(): void {
    this.layerOrder.sort((a, b) => {
      const za = this.layers.get(a)?.zIndex ?? 0;
      const zb = this.layers.get(b)?.zIndex ?? 0;
      return za - zb;
    });
  }

  private getSortedLayers(): LayerInfo[] {
    this.sortLayers();
    return this.layerOrder
      .map((id) => this.layers.get(id)!)
      .filter(Boolean);
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('GlobalDisplayAPI: Not initialized. Call initialize() first.');
    }
  }
}

export default GlobalDisplayAPI;
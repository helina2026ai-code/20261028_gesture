export const SAMPLE_SLIDES = [
  { src: "./images/01-mountains.svg", title: "山間晨光", description: "讓視線越過稜線，留一點時間給遠方。" },
  { src: "./images/02-ocean.svg", title: "海邊慢行", description: "潮汐輕輕往返，海風帶走了時間。" },
  { src: "./images/03-desert.svg", title: "沙丘日落", description: "暖色落在沙丘上，沿著曲線緩緩流動。" },
  { src: "./images/04-forest.svg", title: "森林之境", description: "穿過樹影，在安靜的地方深呼吸。" },
  { src: "./images/05-city.svg", title: "城市微光", description: "當天空漸暗，每一扇窗都亮起自己的故事。" },
].map((slide) => ({ ...slide, src: new URL(slide.src, import.meta.url).href }));

export class SlideDeck {
  constructor(slides = SAMPLE_SLIDES) {
    this.setSlides(slides);
  }
  setSlides(slides) {
    if (!Array.isArray(slides) || !slides.length) throw new Error("至少需要一張圖片。");
    this.slides = [...slides];
    this.index = 0;
    this.mirroredSlides = new Set();
    this.verticallyMirroredSlides = new Set();
    this.views = new Map();
  }
  get isMirrored() {
    return this.mirroredSlides.has(this.index);
  }
  toggleMirror() {
    if (this.isMirrored) this.mirroredSlides.delete(this.index);
    else this.mirroredSlides.add(this.index);
    return this.isMirrored;
  }
  get isVerticallyMirrored() {
    return this.verticallyMirroredSlides.has(this.index);
  }
  toggleVerticalMirror() {
    if (this.isVerticallyMirrored) this.verticallyMirroredSlides.delete(this.index);
    else this.verticallyMirroredSlides.add(this.index);
    return this.isVerticallyMirrored;
  }
  get view() {
    return { ...(this.views.get(this.index) ?? { scale: 1, rotation: 0 }) };
  }
  setView({ scale, rotation }) {
    if (!Number.isFinite(scale) || !Number.isFinite(rotation)) throw new Error("圖片大小與角度必須是有效數值。");
    const boundedScale = Math.max(1, Math.min(3, scale));
    const normalizedRotation = ((rotation + 180) % 360 + 360) % 360 - 180;
    this.views.set(this.index, { scale: boundedScale, rotation: normalizedRotation });
  }
  resetView() {
    this.views.delete(this.index);
  }
  navigate(action) {
    const previous = this.index;
    switch (action) {
      case "first": this.index = 0; break;
      case "last": this.index = this.slides.length - 1; break;
      case "previous": this.index = Math.max(0, this.index - 1); break;
      case "next": this.index = Math.min(this.slides.length - 1, this.index + 1); break;
      default: throw new Error(`Unknown gallery action: ${action}`);
    }
    return this.index !== previous;
  }
}

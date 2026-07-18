/* Reusable drag-to-spin 360° viewer. Works with any ordered array of frame
   image URLs — swap in real photography frames later without touching this file. */

class SpinViewer {
  constructor({ el, imgEl, frames, progressEl, hintEl, sensitivity = 8 }) {
    this.el = el;
    this.imgEl = imgEl;
    this.frames = frames;
    this.progressEl = progressEl || null;
    this.hintEl = hintEl || null;
    this.sensitivity = sensitivity;
    this.index = 0;
    this.dragging = false;
    this.startX = 0;
    this.startIndex = 0;
    this.autoplayTimer = null;
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._buildProgress();
    this._bind();
  }

  setFrames(frames) {
    this.stopAutoplay();
    this.frames = frames;
    this.index = 0;
    this.el.classList.remove("spun");
    this._buildProgress();
    this._render();
  }

  _buildProgress() {
    if (!this.progressEl) return;
    this.progressEl.innerHTML = "";
    this.frames.forEach((_, i) => {
      const dot = document.createElement("span");
      if (i === 0) dot.classList.add("active");
      this.progressEl.appendChild(dot);
    });
  }

  _render() {
    if (!this.frames.length) return;
    this.imgEl.src = this.frames[this.index];
    if (this.progressEl) {
      [...this.progressEl.children].forEach((dot, i) => dot.classList.toggle("active", i === this.index));
    }
  }

  setIndex(i) {
    const n = this.frames.length;
    if (!n) return;
    this.index = ((i % n) + n) % n;
    this._render();
  }

  _bind() {
    this.el.addEventListener("pointerdown", this._onPointerDown);
    this.el.addEventListener("pointermove", this._onPointerMove);
    this.el.addEventListener("pointerup", this._onPointerUp);
    this.el.addEventListener("pointercancel", this._onPointerUp);
    this.el.addEventListener("pointerleave", (e) => {
      if (this.dragging && e.pointerType !== "touch") this._onPointerUp(e);
    });
  }

  _onPointerDown(e) {
    this.stopAutoplay();
    this.dragging = true;
    this.startX = e.clientX;
    this.startIndex = this.index;
    this.el.classList.add("dragging");
    try { this.el.setPointerCapture(e.pointerId); } catch (_) {}
  }

  _onPointerMove(e) {
    if (!this.dragging) return;
    const dx = e.clientX - this.startX;
    const steps = -Math.round(dx / this.sensitivity);
    this.setIndex(this.startIndex + steps);
    if (Math.abs(dx) > 6) this.el.classList.add("spun");
  }

  _onPointerUp() {
    this.dragging = false;
    this.el.classList.remove("dragging");
  }

  startAutoplay(intervalMs = 90) {
    this.stopAutoplay();
    this.el.classList.add("spun");
    this.autoplayTimer = setInterval(() => this.setIndex(this.index + 1), intervalMs);
  }

  stopAutoplay() {
    if (this.autoplayTimer) {
      clearInterval(this.autoplayTimer);
      this.autoplayTimer = null;
    }
  }

  destroy() {
    this.stopAutoplay();
  }
}

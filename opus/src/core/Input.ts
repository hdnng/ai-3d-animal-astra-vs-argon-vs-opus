/**
 * Keyboard + mouse input state. Tracks held keys and per-frame "pressed"
 * edges so gameplay code can poll without event handlers.
 */
export class Input {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  /** Accumulated pointer drag since last frame (pixels). */
  dragX = 0;
  dragY = 0;
  /** Accumulated wheel delta since last frame. */
  wheel = 0;
  dragging = false;
  private lastX = 0;
  private lastY = 0;
  private dragButton = -1;
  private disposers: (() => void)[] = [];

  constructor(private element: HTMLElement) {
    const kd = (e: KeyboardEvent): void => {
      if (this.isTypingTarget(e.target)) return;
      if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
      // Prevent page scroll on arrows/space while playing.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    };
    const ku = (e: KeyboardEvent): void => {
      this.down.delete(e.code);
    };
    const blur = (): void => {
      this.down.clear();
      this.dragging = false;
    };
    const pd = (e: PointerEvent): void => {
      if (e.target !== this.element) return;
      this.dragging = true;
      this.dragButton = e.button;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.element.setPointerCapture?.(e.pointerId);
    };
    const pm = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragX += e.clientX - this.lastX;
      this.dragY += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    };
    const pu = (e: PointerEvent): void => {
      this.dragging = false;
      this.dragButton = -1;
      if (this.element.hasPointerCapture?.(e.pointerId)) this.element.releasePointerCapture(e.pointerId);
    };
    const wh = (e: WheelEvent): void => {
      if (e.target !== this.element) return;
      this.wheel += Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120);
      e.preventDefault();
    };
    const ctx = (e: Event): void => e.preventDefault();

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    element.addEventListener('pointerdown', pd);
    window.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    element.addEventListener('wheel', wh, { passive: false });
    element.addEventListener('contextmenu', ctx);
    this.disposers.push(
      () => window.removeEventListener('keydown', kd),
      () => window.removeEventListener('keyup', ku),
      () => window.removeEventListener('blur', blur),
      () => element.removeEventListener('pointerdown', pd),
      () => window.removeEventListener('pointermove', pm),
      () => window.removeEventListener('pointerup', pu),
      () => element.removeEventListener('wheel', wh),
      () => element.removeEventListener('contextmenu', ctx),
    );
  }

  private isTypingTarget(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox';
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  anyDown(...codes: string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  /** Simulate a key press from code (used by UI buttons and tests). */
  inject(code: string, held = false): void {
    this.pressedThisFrame.add(code);
    if (held) this.down.add(code);
  }

  release(code: string): void {
    this.down.delete(code);
  }

  get isRightDrag(): boolean {
    return this.dragButton === 2;
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.dragX = 0;
    this.dragY = 0;
    this.wheel = 0;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}

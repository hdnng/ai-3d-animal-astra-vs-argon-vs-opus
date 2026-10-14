/**
 * Unified Keyboard & Pointer Input Manager
 * Supports manual wolf locomotion (WASD / Arrows + Shift + Space + Action keys)
 * and smooth camera orbit / zoom interaction.
 */
export class InputManager {
  private keys = new Set<string>();
  private justPressed = new Set<string>();

  public pointerDown = false;
  public pointerDeltaX = 0;
  public pointerDeltaY = 0;
  public wheelDelta = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;
  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onPointerUpBound: () => void;
  private onWheelBound: (e: WheelEvent) => void;
  private targetElement: HTMLElement;

  constructor(targetElement: HTMLElement) {
    this.targetElement = targetElement;

    this.onKeyDownBound = (e: KeyboardEvent) => {
      const code = e.code;
      if (!this.keys.has(code)) {
        this.justPressed.add(code);
      }
      this.keys.add(code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(code)) {
        e.preventDefault();
      }
    };

    this.onKeyUpBound = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };

    this.onPointerDownBound = (e: PointerEvent) => {
      if (e.button === 0) {
        this.pointerDown = true;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
      }
    };

    this.onPointerMoveBound = (e: PointerEvent) => {
      if (!this.pointerDown) return;
      this.pointerDeltaX += e.clientX - this.lastPointerX;
      this.pointerDeltaY += e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    };

    this.onPointerUpBound = () => {
      this.pointerDown = false;
    };

    this.onWheelBound = (e: WheelEvent) => {
      this.wheelDelta += Math.sign(e.deltaY);
    };

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    this.targetElement.addEventListener('pointerdown', this.onPointerDownBound);
    window.addEventListener('pointermove', this.onPointerMoveBound);
    window.addEventListener('pointerup', this.onPointerUpBound);
    this.targetElement.addEventListener('wheel', this.onWheelBound, { passive: true });
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  consumeJustPressed(code: string): boolean {
    if (this.justPressed.has(code)) {
      this.justPressed.delete(code);
      return true;
    }
    return false;
  }

  hasMovementInput(): boolean {
    return (
      this.isDown('KeyW') ||
      this.isDown('KeyS') ||
      this.isDown('KeyA') ||
      this.isDown('KeyD') ||
      this.isDown('ArrowUp') ||
      this.isDown('ArrowDown') ||
      this.isDown('ArrowLeft') ||
      this.isDown('ArrowRight')
    );
  }

  getForwardAxis(): number {
    let f = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) f += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) f -= 1;
    return f;
  }

  getTurnAxis(): number {
    let t = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) t += 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) t -= 1;
    return t;
  }

  isSprintDown(): boolean {
    return this.isDown('ShiftLeft') || this.isDown('ShiftRight');
  }

  endFrame(): void {
    this.justPressed.clear();
    this.pointerDeltaX = 0;
    this.pointerDeltaY = 0;
    this.wheelDelta = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    this.targetElement.removeEventListener('pointerdown', this.onPointerDownBound);
    window.removeEventListener('pointermove', this.onPointerMoveBound);
    window.removeEventListener('pointerup', this.onPointerUpBound);
    this.targetElement.removeEventListener('wheel', this.onWheelBound);
  }
}

export class Input {
  keys = new Set<string>();
  onAction: (key: string) => void = () => {};
  private down = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).matches("input,select,textarea")) return;
    const k = e.key.toLowerCase();
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k))
      e.preventDefault();
    if (!e.repeat) this.onAction(k);
    this.keys.add(k);
  };
  private up = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private blur = () => this.keys.clear();
  constructor() {
    window.addEventListener("keydown", this.down);
    window.addEventListener("keyup", this.up);
    window.addEventListener("blur", this.blur);
  }
  has(...keys: string[]) {
    return keys.some((k) => this.keys.has(k));
  }
  dispose() {
    window.removeEventListener("keydown", this.down);
    window.removeEventListener("keyup", this.up);
    window.removeEventListener("blur", this.blur);
  }
}

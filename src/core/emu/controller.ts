export type Button = "a" | "b" | "select" | "start" | "up" | "down" | "left" | "right";

const ORDER: readonly Button[] = ["a", "b", "select", "start", "up", "down", "left", "right"];

/** Standard NES controller with the usual strobe/serial-read protocol. */
export class Controller {
  private readonly state: Record<Button, boolean> = {
    a: false,
    b: false,
    select: false,
    start: false,
    up: false,
    down: false,
    left: false,
    right: false,
  };
  private shift = 0;
  private strobe = false;

  setButton(button: Button, pressed: boolean): void {
    this.state[button] = pressed;
  }

  write(value: number): void {
    this.strobe = (value & 1) !== 0;
    if (this.strobe) this.shift = 0;
  }

  read(): number {
    if (this.shift >= 8) return 1;
    const button = ORDER[this.strobe ? 0 : this.shift];
    const pressed = button ? this.state[button] : false;
    if (!this.strobe) this.shift += 1;
    return pressed ? 1 : 0;
  }
}

// Keyboard + mouse input with pointer lock. In shot mode, input is disabled.
export class Input {
  constructor(el, disabled = false) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: 0, wheel: 0 };
    this.locked = false;
    if (disabled) return;
    addEventListener('keydown', (e) => { if (!this.keys.has(e.code)) this.pressed.add(e.code); this.keys.add(e.code); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('click', () => el.requestPointerLock?.());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
    addEventListener('mousemove', (e) => { if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    addEventListener('mousedown', (e) => { this.mouse.buttons |= 1 << e.button; });
    addEventListener('mouseup', (e) => { this.mouse.buttons &= ~(1 << e.button); });
    addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); });
  }
  down(code) { return this.keys.has(code); }
  justPressed(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; }
}

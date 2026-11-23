// Tiny shared mutable store read inside rAF loops (no React re-renders).
export const telemetry = {
  /** Car speed in km/h, written by the 3D scene, read by the HUD. */
  speed: 0,
  /** Asset loading progress 0..1 (3D model). */
  load: 0,
  /** True once the 3D scene rendered its first frame (or failed and gave up). */
  ready: false,
  /** Scroll velocity (px/frame) written by the smooth-scroll layer. */
  scrollVel: 0,
};

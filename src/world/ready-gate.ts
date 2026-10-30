import type { RevealHoldStatus } from "./reveal-hold";

// A shadow update was requested and the renderer has not consumed it yet. three clears `light.shadow.needsUpdate`
// after the frame that renders the shadow map, so a request that reads back false has been drawn.
export function shadowSettled({
  requested,
  needsUpdate,
}: {
  requested: boolean;
  needsUpdate: boolean;
}): boolean {
  return !requested || !needsUpdate;
}

// The stage reveals only when the camera is fitted and active, the reveal hold is over, and the first shadow
// render after the instance upload has happened (the first revealed frame already carries the tower's shadow).
export function stageReady({
  fitted,
  cameraActive,
  holdStatus,
  shadowPending,
}: {
  fitted: boolean;
  cameraActive: boolean;
  holdStatus: RevealHoldStatus;
  shadowPending: boolean;
}): boolean {
  return fitted && cameraActive && holdStatus !== "pending" && !shadowPending;
}

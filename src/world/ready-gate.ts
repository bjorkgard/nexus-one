import type { RevealHoldStatus } from "./reveal-hold";

// True when no shadow update is outstanding: none was requested, or three has consumed it. three clears
// `light.shadow.needsUpdate` after the frame that renders the shadow map, so a request that reads back false has been drawn.
export function shadowSettled({
  requested,
  needsUpdate,
}: {
  requested: boolean;
  needsUpdate: boolean;
}): boolean {
  return !requested || !needsUpdate;
}

// Whether the first shadow render is still outstanding. Nothing to wait for without a tower or with the shadow
// map disabled; otherwise no upload requested yet also counts as pending.
export function shadowPending({
  towerVisible,
  enabled,
  requested,
  needsUpdate,
}: {
  towerVisible: boolean;
  enabled: boolean;
  requested: boolean;
  needsUpdate: boolean;
}): boolean {
  return towerVisible && enabled && (!requested || !shadowSettled({ requested, needsUpdate }));
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

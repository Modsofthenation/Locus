"use strict";

/** Backoff before spawning the control plane again after it dies. */
function restartDelayMs(attempt, minMs = 500, maxMs = 8_000) {
  const n = Math.max(0, Number(attempt) || 0);
  return Math.min(maxMs, minMs * 2 ** n);
}

const HEALTH_FAILS_BEFORE_KILL = 3;

/**
 * True when the desktop should spawn a new control plane.
 * A live child/adopted pid that failed a health probe is given a few tries
 * so a slow snapshot does not get killed; a dead pid respawns immediately.
 */
function controlPlaneNeedsRespawn(input) {
  if (!input || input.quitting) return false;
  if (input.healthUp) return false;
  if (input.processAlive) {
    const fails = Number(input.failCount) || 0;
    return fails >= HEALTH_FAILS_BEFORE_KILL;
  }
  return true;
}

/**
 * What to do at desktop launch when port 7420 may already be taken.
 * Health without UI is the AppImage "Locus UI is not on this port" case:
 * restart a desktop-owned plane so it can pick up the bundled UI; leave a
 * `locus serve` process alone.
 */
function controlPlaneStartAction(input) {
  if (!input) return "start";
  if (input.healthUp && input.uiUp) return "adopt";
  if (input.healthUp && input.owned) return "restart";
  if (input.healthUp) return "leave";
  return "start";
}

module.exports = {
  restartDelayMs,
  controlPlaneNeedsRespawn,
  controlPlaneStartAction,
  HEALTH_FAILS_BEFORE_KILL,
};

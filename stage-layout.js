export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

export function calculateStageFit(hostWidth, hostHeight) {
  const width = Math.max(0, Number(hostWidth) || 0);
  const height = Math.max(0, Number(hostHeight) || 0);
  const scale = Math.min(
    width / STAGE_WIDTH,
    height / STAGE_HEIGHT
  );
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  return {
    scale: safeScale,
    width: STAGE_WIDTH * safeScale,
    height: STAGE_HEIGHT * safeScale
  };
}

export function isNativeStageSize(hostWidth, hostHeight, tolerance = 0.5) {
  const width = Number(hostWidth) || 0;
  const height = Number(hostHeight) || 0;
  const safeTolerance = Math.max(0, Number(tolerance) || 0);

  return Math.abs(width - STAGE_WIDTH) <= safeTolerance
    && Math.abs(height - STAGE_HEIGHT) <= safeTolerance;
}

export function normalizeStagePoint(clientX, clientY, bounds) {
  const width = Math.max(Number(bounds?.width) || 0, 1);
  const height = Math.max(Number(bounds?.height) || 0, 1);

  return {
    x: clamp((Number(clientX) - Number(bounds?.left || 0)) / width, 0, 1),
    y: clamp((Number(clientY) - Number(bounds?.top || 0)) / height, 0, 1)
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

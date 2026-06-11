export type Rect = { x: number; y: number; w: number; h: number }

const GRID = 48
const STRIP_H = 36
const DOCK_H = 40

export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

export const plotRect = (viewportW: number): Rect => ({
  x: Math.round((viewportW - 460) / 2),
  y: STRIP_H + 12,
  w: 460,
  h: 260,
})

// Scan 48px-grid anchor slots left-to-right, top-to-bottom; take the first
// whose rect intersects neither THE PLOT (+24px margin), the strip, the dock,
// nor existing cards. Cascade fallback when the screen is full.
export const placeCard = (
  existing: Rect[],
  viewport: { w: number; h: number },
  size: { w: number; h: number } = { w: 720, h: 460 },
): { x: number; y: number } => {
  const plot = plotRect(viewport.w)
  const keepOut: Rect[] = [
    { x: plot.x - 24, y: plot.y - 24, w: plot.w + 48, h: plot.h + 48 },
    { x: 0, y: 0, w: viewport.w, h: STRIP_H },
    { x: 0, y: viewport.h - DOCK_H, w: viewport.w, h: DOCK_H },
  ]
  for (let y = STRIP_H + 12; y + size.h <= viewport.h - DOCK_H; y += GRID) {
    for (let x = 16; x + size.w <= viewport.w - 8; x += GRID) {
      const rect = { x, y, w: size.w, h: size.h }
      if (!keepOut.some(r => intersects(rect, r)) && !existing.some(r => intersects(rect, r))) {
        return { x, y }
      }
    }
  }
  const last = existing[existing.length - 1]
  return last ? { x: last.x + 24, y: last.y + 24 } : { x: 96, y: 96 }
}

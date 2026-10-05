import {Shape, Path, ExtrudeGeometry} from 'three';

// Synthetic mounting plate; no uploaded customer model is bundled.
export function createTutorialGeometry() {
  const shape = new Shape(), x = 180, y = 70, r = 12;
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  for (const cx of [-120, 120]) {
    const hole = new Path();
    hole.absarc(cx, 0, 12, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  return new ExtrudeGeometry(shape, {depth: 18, bevelEnabled: false, curveSegments: 16, steps: 1});
}

// Pointer Events keep horizontal swipes separate from the browser's vertical scroll.
export function bindHeroSwipe(element, { getIndex, getCount, onChange }) {
  let gesture = null;
  let suppressClickUntil = 0;
  const interactive = target => target?.closest?.('button, a, input, select, textarea, [role="button"]');
  const reset = () => { gesture = null; };
  function change(direction) {
    const count = getCount();
    if (count > 1) onChange((getIndex() + direction + count) % count);
  }
  element.addEventListener('pointerdown', event => {
    if (event.isPrimary === false) { reset(); return; }
    if (!['touch', 'pen'].includes(event.pointerType) || interactive(event.target) || getCount() < 2) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, started: event.timeStamp };
  });
  element.addEventListener('pointerup', event => {
    const start = gesture; reset();
    if (!start || start.id !== event.pointerId) return;
    const x = event.clientX - start.x; const y = event.clientY - start.y;
    if (Math.abs(x) < 44 || Math.abs(x) < Math.abs(y) * 1.3 || event.timeStamp - start.started > 1500) return;
    suppressClickUntil = event.timeStamp + 600;
    change(x < 0 ? 1 : -1);
  });
  element.addEventListener('pointercancel', reset);
  element.addEventListener('pointerleave', reset);
  element.addEventListener('click', event => {
    if (event.timeStamp < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  element.addEventListener('keydown', event => {
    if (interactive(event.target) || !['ArrowLeft', 'ArrowRight'].includes(event.key) || getCount() < 2) return;
    event.preventDefault(); change(event.key === 'ArrowLeft' ? -1 : 1);
  });
}

// Pure rules of the scrollable TabBar (docs/ui-guideline.md §4.8), unit-tested
// in test/tabsModel.test.js.

// Which ends of the tab row can still scroll. A 1px slack absorbs sub-pixel
// widths, so a row that fits exactly never shows a chevron.
export function scrollEdges({ scrollLeft = 0, clientWidth = 0, scrollWidth = 0 } = {}) {
  return {
    start: scrollLeft > 1,
    end: scrollLeft + clientWidth < scrollWidth - 1,
  };
}

// The same object back when nothing changed, so a state setter bails out and
// a measurement can never cause another render.
export function nextEdges(current, measured) {
  return current && current.start === measured.start && current.end === measured.end ? current : measured;
}

// Room kept at each end for the chevron that floats over the row.
export const TAB_SCROLL_PAD = 40;

// scrollLeft that brings the tab [left, right) into view (row coordinates),
// clear of the chevron overlay; the current value when it is already in view.
export function scrollToReveal({ left, right }, { scrollLeft, clientWidth }, pad = TAB_SCROLL_PAD) {
  if (left < scrollLeft + pad) return Math.max(0, left - pad);
  if (right > scrollLeft + clientWidth - pad) return right - clientWidth + pad;
  return scrollLeft;
}

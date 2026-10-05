/**
 * Runs in the page (desktop view) and returns PageFacts. Kept as a plain JS string so no TS/esbuild
 * transform can inject helpers that don't exist in the browser (see EXTRACT_SCRIPT in crawler.ts).
 *
 * Text is grouped into "blocks" by nearest block-level ancestor. For each block we keep the
 * smallest font size and that text's colour and effective background (first non-transparent
 * ancestor background; background images and gradients are ignored). Boxes are document
 * coordinates, i.e. full-page screenshot pixels at deviceScaleFactor 1.
 */
export const FACTS_SCRIPT = String.raw `(() => {
  const MAX_BLOCKS = 3000;
  const MAX_TEXT = 2000;
  const MAX_IMAGES = 500;
  const BLOCK_TAGS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'DT', 'DD',
    'FIGCAPTION', 'BLOCKQUOTE', 'CAPTION', 'LABEL', 'BUTTON', 'SUMMARY', 'LEGEND', 'PRE', 'ADDRESS']);
  const BLOCK_DISPLAY = /^(block|list-item|table-cell|table-caption|flex|grid|flow-root)$/;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'HEAD', 'SELECT', 'OPTION']);
  const sx = window.scrollX;
  const sy = window.scrollY;

  const toBox = (r) => ({
    x: Math.round(r.left + sx), y: Math.round(r.top + sy),
    width: Math.round(r.width), height: Math.round(r.height),
  });
  const parseColor = (s) => {
    const m = /^rgba?\(([^)]+)\)$/.exec((s || '').trim());
    if (!m) return [0, 0, 0, 1];
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? p[3] : 1];
  };
  const visible = (el) =>
    !el.checkVisibility || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const skipped = (el) => {
    for (let e = el; e; e = e.parentElement) if (SKIP_TAGS.has(e.tagName.toUpperCase())) return true;
    return false;
  };
  const blockOf = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (BLOCK_TAGS.has(e.tagName)) return e;
      if (BLOCK_DISPLAY.test(getComputedStyle(e).display)) return e;
    }
    return document.body;
  };
  const backgroundOf = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = parseColor(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) return c;
    }
    return [255, 255, 255, 1];
  };
  const regionOf = (el) =>
    el.closest('footer, [role="contentinfo"]') ? 'footer'
      : el.closest('nav, [role="navigation"]') ? 'nav'
      : el.closest('header, [role="banner"]') ? 'header'
      : null;
  const headingLevel = (el) => {
    const m = /^H([1-6])$/.exec(el.tagName);
    if (m) return Number(m[1]);
    if (el.getAttribute('role') === 'heading') return Number(el.getAttribute('aria-level')) || 2;
    return null;
  };

  const groups = new Map();
  let truncated = false;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || skipped(parent)) continue;
    const value = n.nodeValue || '';
    const block = blockOf(parent);
    let group = groups.get(block);
    if (!value.trim()) {
      if (group) group.parts.push(' ');
      continue;
    }
    if (!visible(parent)) continue;
    const r = parent.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue; // visually hidden (e.g. screen-reader-only)
    if (!group) {
      if (groups.size >= MAX_BLOCKS) { truncated = true; break; }
      group = {
        el: block,
        parts: [],
        text: { size: Infinity, el: null },
        script: { size: Infinity, el: null },
      };
      groups.set(block, group);
    }
    group.parts.push(value);
    // Superscripts/subscripts (reference markers, ®) are small by design, so they only set the
    // block's size when it has no other text.
    const key = parent.closest('sup, sub') ? 'script' : 'text';
    const size = parseFloat(getComputedStyle(parent).fontSize);
    if (size < group[key].size) group[key] = { size, el: parent };
  }

  const blocks = [];
  for (const g of groups.values()) {
    const text = g.parts.join('').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!text) continue;
    const smallest = g.text.el ? g.text : g.script;
    const cs = getComputedStyle(smallest.el);
    blocks.push({
      text,
      tag: g.el.tagName.toLowerCase(),
      headingLevel: headingLevel(g.el),
      region: regionOf(g.el),
      box: toBox(g.el.getBoundingClientRect()),
      fontSize: Math.round(smallest.size * 100) / 100,
      fontWeight: Number(cs.fontWeight) || 400,
      color: parseColor(cs.color),
      background: backgroundOf(smallest.el),
      hasSup: g.el.tagName === 'SUP' || !!g.el.querySelector('sup'),
    });
  }

  const images = [];
  for (const img of Array.from(document.images).slice(0, MAX_IMAGES)) {
    const r = img.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || !visible(img)) continue;
    images.push({
      src: (img.currentSrc || img.src || '').slice(0, 300),
      alt: img.getAttribute('alt'),
      role: img.getAttribute('role'),
      ariaHidden: !!img.closest('[aria-hidden="true"]'),
      box: toBox(r),
    });
  }

  return { blocks, images, truncated };
})()`;
//# sourceMappingURL=facts-script.js.map
import { Graphviz } from '@hpcc-js/wasm-graphviz';
import { Resvg } from '@resvg/resvg-js';
import { toDot } from './dot.js';
import { buildSiteTree, maxFanOut, type SiteMapPage } from './tree.js';

let graphviz: Promise<Graphviz> | null = null;
const loadGraphviz = () => (graphviz ??= Graphviz.load());

/** A parent with more children than this has its leaf children staggered over several rows. */
const MAX_ROW_FANOUT = 6;
const MAX_STAGGER_ROWS = 4;
/** Upper bound on PNG width in pixels; large maps are scaled down to fit. */
const MAX_PNG_WIDTH = 8000;

export interface SiteMapOptions {
  caption?: string;
}

/** Renders the site map as SVG, or null if there are no pages. */
export async function renderSiteMapSvg(
  pages: SiteMapPage[],
  opts: SiteMapOptions = {},
): Promise<string | null> {
  const root = buildSiteTree(pages);
  if (!root) return null;

  const gv = await loadGraphviz();
  let dot = toDot(root, opts);
  const fanOut = maxFanOut(root);
  if (fanOut > MAX_ROW_FANOUT) {
    // unflatten -l N: staggers leaf children across up to N ranks so wide levels wrap.
    dot = gv.unflatten(dot, Math.min(MAX_STAGGER_ROWS, Math.ceil(fanOut / MAX_ROW_FANOUT)));
  }
  return gv.layout(dot, 'svg', 'dot');
}

/** Rasterises an SVG to PNG at `scale`× (reduced if the result would exceed MAX_PNG_WIDTH). */
export function svgToPng(svg: string, scale = 2): Buffer {
  const font = {
    loadSystemFonts: true,
    defaultFontFamily: 'Helvetica',
    sansSerifFamily: 'Helvetica',
  };
  const baseWidth = new Resvg(svg, { font }).width;
  const zoom = Math.min(scale, MAX_PNG_WIDTH / baseWidth);
  return new Resvg(svg, { font, fitTo: { mode: 'zoom', value: zoom }, background: 'white' })
    .render()
    .asPng();
}

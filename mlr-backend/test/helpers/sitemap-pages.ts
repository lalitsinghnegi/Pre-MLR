import type { SiteMapPage } from '../../src/sitemap/tree.js';

let n = 0;
/** Build a SiteMapPage with sensible defaults; crawlIndex increments per call unless given. */
export function sp(overrides: Partial<SiteMapPage> & { id: string }): SiteMapPage {
  return {
    crawlIndex: n++,
    url: `https://example.com/${overrides.id}`,
    parentPageId: null,
    title: null,
    httpStatus: 200,
    error: null,
    ...overrides,
  };
}

/** home → about, products → widget, gadget; products → broken (404) */
export function sampleSite(): SiteMapPage[] {
  return [
    sp({ id: 'home', crawlIndex: 0, url: 'https://example.com/', title: 'Home | Examplin' }),
    sp({
      id: 'about',
      crawlIndex: 1,
      parentPageId: 'home',
      url: 'https://example.com/about',
      title: 'About | Examplin',
    }),
    sp({
      id: 'products',
      crawlIndex: 2,
      parentPageId: 'home',
      url: 'https://example.com/products',
      title: 'Products | Examplin',
    }),
    sp({
      id: 'widget',
      crawlIndex: 3,
      parentPageId: 'products',
      url: 'https://example.com/products/widget',
      title: 'Widget | Examplin',
    }),
    sp({
      id: 'gadget',
      crawlIndex: 4,
      parentPageId: 'products',
      url: 'https://example.com/products/gadget',
      title: 'Gadget | Examplin',
    }),
    sp({
      id: 'broken',
      crawlIndex: 5,
      parentPageId: 'products',
      url: 'https://example.com/products/old',
      httpStatus: 404,
      error: 'HTTP 404',
    }),
  ];
}

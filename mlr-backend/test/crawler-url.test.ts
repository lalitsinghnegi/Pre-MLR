import { describe, expect, it } from 'vitest';
import { isSameSite, looksLikeHtml, normalizeUrl } from '../src/crawler/url.js';

describe('normalizeUrl', () => {
  it.each([
    ['https://Example.COM/About/', 'https://example.com/About'],
    ['https://example.com/a#section', 'https://example.com/a'],
    ['https://example.com:443/a', 'https://example.com/a'],
    ['http://user:pw@example.com/a', 'http://example.com/a'],
    ['https://example.com', 'https://example.com/'],
    ['https://example.com/?q=1', 'https://example.com/?q=1'],
    ['https://example.com/a//', 'https://example.com/a'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it('resolves relative URLs against a base', () => {
    expect(normalizeUrl('gadget', 'https://example.com/products/')).toBe(
      'https://example.com/products/gadget',
    );
  });

  it.each([
    'mailto:a@example.com',
    'tel:+1555',
    'javascript:void(0)',
    'ftp://example.com/',
    'not a url',
  ])('rejects %s', (input) => {
    expect(normalizeUrl(input)).toBeNull();
  });
});

describe('isSameSite', () => {
  it('treats www and bare host as the same site', () => {
    expect(isSameSite('https://www.example.com/a', 'https://example.com/')).toBe(true);
  });
  it('rejects other hosts, subdomains and ports', () => {
    expect(isSameSite('https://other.com/', 'https://example.com/')).toBe(false);
    expect(isSameSite('https://shop.example.com/', 'https://example.com/')).toBe(false);
    expect(isSameSite('http://localhost:4000/', 'http://localhost:3000/')).toBe(false);
  });
});

describe('looksLikeHtml', () => {
  it('skips documents, images and other assets', () => {
    expect(looksLikeHtml('https://example.com/pi.PDF')).toBe(false);
    expect(looksLikeHtml('https://example.com/logo.png')).toBe(false);
  });
  it('accepts pages with or without .html', () => {
    expect(looksLikeHtml('https://example.com/about')).toBe(true);
    expect(looksLikeHtml('https://example.com/about.html')).toBe(true);
    expect(looksLikeHtml('https://example.com/')).toBe(true);
  });
});

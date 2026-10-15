import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_DEFAULTS, parseCatalog, catalogHash, pageFromLocation, sortCatalogItems } from '../frontend/catalog-state.js';

test('default entry is home while existing search and discover links keep their destination', () => {
  assert.equal(pageFromLocation('', ''), 'home');
  assert.equal(pageFromLocation('', '?q=Python'), 'search');
  assert.equal(pageFromLocation('#discover?type=movie', '?q=Python'), 'discover');
  assert.equal(pageFromLocation('#home', '?q=Python'), 'home');
  assert.deepEqual(parseCatalog('#discover'), CATALOG_DEFAULTS);
});

test('shareable catalog hashes preserve region, platform, custom dates and exact score thresholds', () => {
  const value = { type: 'anime_movie', region: 'JP', platform: 'netflix', period: 'custom', from: '2024-01-01', to: '2026-10-15', sort: 'rating_asc', minVotes: '100', minRating: '7.5' };
  assert.deepEqual(parseCatalog(catalogHash(value)), value);
  assert.equal(catalogHash(CATALOG_DEFAULTS), '#discover');
  assert.equal(catalogHash({ ...CATALOG_DEFAULTS, from: '2020-01-01' }), '#discover');
});

test('invalid catalog inputs cannot inject markup or silently widen an explicit platform selection', () => {
  const value = parseCatalog('#discover?type=person&region=XX&platform=netflix&period=bad&sort=<script>&minVotes=-1&minRating=11');
  assert.deepEqual(value, { ...CATALOG_DEFAULTS, platform: 'netflix' });
  assert.equal(parseCatalog('#discover?period=custom&from=bad').from, undefined);
  assert.equal(parseCatalog('#discover?minRating=7.5').minRating, '7.5');
});

test('direct platform links keep unrestricted region and merged batches remain sorted', () => {
  const hash = catalogHash({ ...CATALOG_DEFAULTS, platform: 'netflix', period: 'all' });
  assert.equal(hash, '#discover?platform=netflix&period=all');
  assert.equal(parseCatalog(hash).region, 'all');
  const items = [{ id: 'a', rating: 8, releaseDate: '2026-01-01' }, { id: 'b', rating: null, releaseDate: '2026-10-01' }, { id: 'c', rating: 9, releaseDate: '2026-05-01' }];
  assert.deepEqual(sortCatalogItems([...items], 'rating').map(item => item.id), ['c', 'a', 'b']);
  assert.deepEqual(sortCatalogItems([...items], 'rating_asc').map(item => item.id), ['a', 'c', 'b']);
  assert.deepEqual(sortCatalogItems([...items], 'newest').map(item => item.id), ['b', 'c', 'a']);
});

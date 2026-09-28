const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../js/playlist-colors.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(`${source}\nthis.palette = WavePlaylistColors;`, context);
const { palette } = context;

function imageOf(r, g, b, count = 100) {
  const pixels = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) pixels.set([r, g, b, 255], i * 4);
  return pixels;
}

test('une grande zone rouge domine les pixels noirs et produit un fond vif et un fond sombre', () => {
  const pixels = new Uint8ClampedArray([...imageOf(213, 24, 34, 80), ...imageOf(8, 8, 8, 20)]);
  const colors = palette.fromPixels(pixels);
  const vivid = colors.vivid.split(',').map(Number);
  const deep = colors.deep.split(',').map(Number);
  assert.ok(vivid[0] > vivid[1] * 2);
  assert.ok(deep[0] < vivid[0] / 2);
});

test('les zones transparentes et les images presque grises utilisent la couleur de repli', () => {
  const transparent = new Uint8ClampedArray([255, 0, 0, 0]);
  assert.deepEqual(palette.fromPixels(transparent, '#2345ab'), palette.fromHex('#2345ab'));
  assert.deepEqual(palette.fromPixels(imageOf(115, 115, 115), '#2345ab'), palette.fromHex('#2345ab'));
});

test('une pochette bleue conserve une teinte bleue plutôt qu’une moyenne grise', () => {
  const rgb = palette.fromPixels(imageOf(23, 68, 194)).vivid.split(',').map(Number);
  assert.ok(rgb[2] > rgb[0] * 2);
});

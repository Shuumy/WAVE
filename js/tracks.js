/**
 * WAVE — Track helpers (artwork generation, duration formatting)
 */

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function generateArtwork(track) {
  if (track.coverArt) return track.coverArt;
  const color  = track.color || '#333333';
  const letter = (track.title || '?')[0].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">` +
    `<rect width="44" height="44" fill="${color}"/>` +
    `<text x="22" y="29" font-family="sans-serif" font-size="20" font-weight="600" ` +
    `fill="rgba(255,255,255,0.85)" text-anchor="middle">${letter}</text>` +
    `</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

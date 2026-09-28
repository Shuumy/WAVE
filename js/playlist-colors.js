/**
 * Palette de playlist. Le choix de la couleur est séparé du rendu : cette
 * fonction reçoit des pixels (faciles à tester) et retourne des canaux RGB
 * pour les dégradés CSS. Elle ne stocke ni image ni données personnelles.
 */
const WavePlaylistColors = (() => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const channels = rgb => rgb.map(value => Math.round(clamp(value, 0, 255))).join(',');

  function hueOf(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) return 0;
    let hue = max === r ? (g - b) / (max - min) : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    return (hue * 60 + 360) % 360;
  }

  function fromPixels(pixels, fallback = '#795548') {
    // Regrouper les teintes en 24 familles. Les pixels très sombres, presque
    // blancs ou transparents ne doivent pas noyer la couleur de la pochette.
    const buckets = Array.from({ length:24 }, () => ({ weight:0, r:0, g:0, b:0 }));
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b, alpha] = pixels.slice(i, i + 4);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const chroma = max - min;
      if (alpha < 160 || max < 35 || min > 220 || chroma < 24) continue;
      const saturation = chroma / Math.max(max, 1);
      // La saturation compte, mais une zone vive occupant une grande surface
      // l'emporte sur un unique pixel fortement saturé.
      const weight = (0.35 + saturation * 1.6) * (0.6 + max / 255);
      const bucket = buckets[Math.floor(hueOf(r, g, b) / 15) % 24];
      bucket.weight += weight;
      bucket.r += r * weight; bucket.g += g * weight; bucket.b += b * weight;
    }
    const dominant = buckets.reduce((best, bucket) => bucket.weight > best.weight ? bucket : best);
    if (!dominant.weight) return fromHex(fallback);
    return build([dominant.r, dominant.g, dominant.b].map(value => value / dominant.weight));
  }

  function build(rgb) {
    const max = Math.max(...rgb), min = Math.min(...rgb);
    const chroma = max - min;
    // Étendre la chroma sans écrêter l'image. Le point lumineux reste éclatant ;
    // le point profond garde suffisamment de noir pour le texte blanc.
    const vivid = rgb.map(value => clamp((value - min) * (170 / Math.max(chroma, 1)) + 42, 22, 225));
    const deep = vivid.map(value => value * .37 + 7);
    const shade = vivid.map(value => value * .11 + 5);
    return { vivid:channels(vivid), deep:channels(deep), shade:channels(shade) };
  }

  function fromHex(hex) {
    const valid = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#795548';
    return build([1, 3, 5].map(i => parseInt(valid.slice(i, i + 2), 16)));
  }

  function fromImage(image, fallback) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 48;
      const ctx = canvas.getContext('2d', { willReadFrequently:true });
      ctx.drawImage(image, 0, 0, 48, 48);
      return fromPixels(ctx.getImageData(0, 0, 48, 48).data, fallback);
    } catch {
      // Une image distante sans autorisation CORS ne peut être échantillonnée.
      return fromHex(fallback);
    }
  }

  return { fromPixels, fromHex, fromImage };
})();

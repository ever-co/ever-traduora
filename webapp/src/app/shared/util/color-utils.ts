export interface HSL {
  hue: number;
  saturation: number;
  luminance: number;
}

export function hexToHSL(hex: string): HSL {
  if (!hex || hex === '') {
    return {
      hue: 0,
      saturation: 0,
      luminance: 0,
    };
  }

  let rs = '0x';
  let gs = '0x';
  let bs = '0x';

  if (hex.length === 4) {
    rs = '0x' + hex[1] + hex[1];
    gs = '0x' + hex[2] + hex[2];
    bs = '0x' + hex[3] + hex[3];
  } else if (hex.length === 7) {
    rs = '0x' + hex[1] + hex[2];
    gs = '0x' + hex[3] + hex[4];
    bs = '0x' + hex[5] + hex[6];
  }

  const r = parseInt(rs, 16) / 255;
  const g = parseInt(gs, 16) / 255;
  const b = parseInt(bs, 16) / 255;

  const minColor = Math.min(r, g, b);
  const maxColor = Math.max(r, g, b);
  const delta = maxColor - minColor;

  let hue = 0;
  let saturation = 0;
  let luminance = 0;

  if (delta === 0) {
    hue = 0;
  } else if (maxColor === r) {
    hue = ((g - b) / delta) % 6;
  } else if (maxColor === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  hue = Math.round(hue * 60);

  if (hue < 0) hue += 360;

  luminance = (maxColor + minColor) / 2;
  saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * luminance - 1));
  saturation = +(saturation * 100).toFixed(1);
  luminance = +(luminance * 100).toFixed(1);

  return {
    hue,
    saturation,
    luminance,
  };
}

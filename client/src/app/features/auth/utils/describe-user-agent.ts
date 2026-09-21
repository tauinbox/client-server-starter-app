export type DeviceDescription = {
  browser: string | null;
  os: string | null;
};

// Order matters: Edge, Opera, Yandex and Samsung Internet also carry "Chrome/"
// and "Safari/", and Chrome carries "Safari/".
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bYaBrowser\//, 'Yandex Browser'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari']
];

// Android carries "Linux", and iPadOS can carry "Mac OS X".
const SYSTEMS: [RegExp, string][] = [
  [/\bAndroid\b/, 'Android'],
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux']
];

function firstMatch(value: string, table: [RegExp, string][]): string | null {
  return table.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

/**
 * Names the browser and the operating system in a User-Agent header, for the
 * list of signed-in devices. It knows the major ones only, and answers null for
 * a part it does not recognise, so the caller can fall back to the raw value.
 */
export function describeUserAgent(userAgent: string | null): DeviceDescription {
  if (!userAgent) return { browser: null, os: null };
  return {
    browser: firstMatch(userAgent, BROWSERS),
    os: firstMatch(userAgent, SYSTEMS)
  };
}

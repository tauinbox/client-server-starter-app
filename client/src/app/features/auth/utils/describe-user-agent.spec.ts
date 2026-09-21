import { describeUserAgent } from './describe-user-agent';

describe('describeUserAgent', () => {
  const cases: [string, string, string | null, string | null][] = [
    [
      'Chrome on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Chrome',
      'Windows'
    ],
    [
      'Edge on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.42',
      'Edge',
      'Windows'
    ],
    [
      'Safari on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
      'Safari',
      'macOS'
    ],
    [
      'Safari on iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
      'Safari',
      'iOS'
    ],
    [
      'Chrome on Android',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
      'Chrome',
      'Android'
    ],
    [
      'Firefox on Linux',
      'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
      'Firefox',
      'Linux'
    ],
    [
      'Yandex Browser on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 YaBrowser/24.7.0.0 Safari/537.36',
      'Yandex Browser',
      'Windows'
    ]
  ];

  it.each(cases)('recognises %s', (_label, ua, browser, os) => {
    expect(describeUserAgent(ua)).toEqual({ browser, os });
  });

  it('answers null for parts it does not recognise', () => {
    expect(describeUserAgent('curl/8.9.1')).toEqual({
      browser: null,
      os: null
    });
    expect(describeUserAgent(null)).toEqual({ browser: null, os: null });
  });
});

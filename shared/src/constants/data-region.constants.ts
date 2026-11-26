/**
 * The data regions a pool can serve (the DATA_REGION variable). Each pool
 * keeps the personal data of its region in its own database, so a region
 * outside this list is a configuration error and refuses the boot.
 *
 * A new region is a member here and an entry of `REGIONS`; no other code
 * names a region (`npm run check:regions`). The union is written out, not
 * derived from a list: a derived union is the same type as every other union
 * of the same strings, and the check finds a region literal by this name.
 */
export type DataRegion = 'intl' | 'ru';

/** The integrations that receive personal data, so each region lists its own. */
export const REGION_INTEGRATIONS = [
  'paddle',
  'yookassa',
  'turnstile',
  'googleOAuth',
  'facebookOAuth',
  'vkOAuth'
] as const;

export type RegionIntegration = (typeof REGION_INTEGRATIONS)[number];

type RegionDefinition = {
  /**
   * The countries whose residents this region holds. A country that no region
   * lists belongs to `UNLISTED_COUNTRY_REGION`.
   */
  readonly countries: readonly CountryCode[];
  /**
   * The integrations that may run in this region. A pool whose env enables
   * another one refuses the boot.
   */
  readonly integrations: readonly RegionIntegration[];
  /**
   * The regions of an SMTP provider (the SMTP_REGION variable) that this
   * region accepts. The mail of the ru region must not leave Russia (152-FZ
   * Art. 18 p. 5).
   */
  readonly smtpProviderRegions: readonly DataRegion[];
  /**
   * The first label of the API host of this region, in front of the host of
   * the SPA (`ru-api` gives `ru-api.<SPA host>`), or null when the API is on
   * the origin of the SPA. The repository holds no production domain, and one
   * client build serves every region, so the host is relative to the SPA.
   * It is code, not a setting: an edit of the settings database cannot send
   * the traffic of a region to another host. `client/nginx.conf` allows each
   * such host in `connect-src` (`npm run check:regions`).
   */
  readonly apiSubdomain: string | null;
};

/** The identity of each region (`doc/architecture.md` 12.8, MR-12). */
export const REGIONS: Readonly<Record<DataRegion, RegionDefinition>> = {
  intl: {
    countries: [],
    integrations: [
      'paddle',
      'turnstile',
      'googleOAuth',
      'facebookOAuth',
      'vkOAuth'
    ],
    smtpProviderRegions: ['intl', 'ru'],
    apiSubdomain: null
  },
  ru: {
    countries: ['RU'],
    integrations: ['yookassa', 'vkOAuth'],
    smtpProviderRegions: ['ru'],
    apiSubdomain: 'ru-api'
  }
};

// The keys of a literal that the annotation above checks in both directions.
export const DATA_REGIONS = Object.keys(REGIONS) as readonly DataRegion[];

/** The region of a resident of a country that no region lists. */
export const UNLISTED_COUNTRY_REGION: DataRegion = 'intl';

/** The regions where `integration` may run, in the order of `DATA_REGIONS`. */
export function integrationRegions(
  integration: RegionIntegration
): DataRegion[] {
  return DATA_REGIONS.filter((region) =>
    REGIONS[region].integrations.includes(integration)
  );
}

/**
 * The region whose pool holds the settings primary. Only the cell of this
 * region writes settings rows; the other cells read them. It is a constant of
 * the code, so an edit of the env or of the settings cannot make another cell
 * write the settings of every region.
 */
export const HOME_DATA_REGION: DataRegion = 'intl';

/** True for the region whose pool writes the settings rows and schema. */
export function writesSettings(region: DataRegion): boolean {
  return region === HOME_DATA_REGION;
}

export function isDataRegion(value: unknown): value is DataRegion {
  return DATA_REGIONS.some((region) => region === value);
}

/** The public URL of each other cell. A region with no entry is not served. */
export type PeerRegions = Partial<Record<DataRegion, string>>;

/** The officially assigned ISO 3166-1 alpha-2 codes. */
export const COUNTRY_CODES = [
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW'
] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

const COUNTRY_CODE_SET: ReadonlySet<string> = new Set(COUNTRY_CODES);

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === 'string' && COUNTRY_CODE_SET.has(value);
}

/**
 * The region that holds the personal data of a resident of `country`. The
 * declared country of residence decides it, because citizenship cannot be
 * verified at registration.
 */
export function regionForCountry(country: CountryCode): DataRegion {
  return (
    DATA_REGIONS.find((region) =>
      REGIONS[region].countries.includes(country)
    ) ?? UNLISTED_COUNTRY_REGION
  );
}

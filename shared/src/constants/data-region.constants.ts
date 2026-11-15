/**
 * The data regions a deployment (a cell) can serve (the DATA_REGION variable).
 * Each cell keeps the personal data of its region in its own database, so a
 * region outside this list is a configuration error and refuses the boot.
 */
export const DATA_REGIONS = ['intl', 'ru'] as const;

export type DataRegion = (typeof DATA_REGIONS)[number];

/** The public URL of each other cell. A region with no entry is not served. */
export type PeerRegions = Partial<Record<DataRegion, string>>;

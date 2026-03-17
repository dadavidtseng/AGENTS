/**
 * Akash Network Placement Attribute Constants
 *
 * **Important:** These constants reflect actual provider usage on Akash mainnet,
 * not the official schema. Providers use different values in practice than
 * documented in the official provider-attributes.json schema.
 *
 * Query command used:
 * ```bash
 * provider-services query provider list --node https://akash-rpc.polkachu.com:443 --output json
 * ```
 *
 * @see https://github.com/akash-network/console/blob/main/config/provider-attributes.json
 * @module targets/akash/constants
 */

/** Geographic regions actually used by Akash providers (not official schema values) */
export const AKASH_REGIONS = {
  // United States
  'us-west': 'Western United States (California, Oregon, Washington, Nevada)',
  'us-central': 'Central United States (Texas, Oklahoma, Kansas, Nebraska)',
  'us-east': 'Eastern United States (New York, Virginia, Florida, etc.)',
  'us-west-1': 'US West Coast (specific providers)',
  'us': 'United States (unspecified region)',

  // Canada
  'ca-central': 'Central Canada (Ontario, Quebec)',
  'ca-east': 'Eastern Canada',
  'ca': 'Canada (unspecified region)',

  // Europe
  'eu-central': 'Central Europe (Germany, Austria, Switzerland)',
  'eu-west': 'Western Europe (France, UK, Netherlands)',
  'eu-east': 'Eastern Europe (Poland, Czech Republic, etc.)',
  'europe': 'Europe (unspecified region)',
  'eu': 'Europe (short form)',

  // Asia
  'asia-east': 'Eastern Asia (China, Japan, Korea)',
  'singapore': 'Singapore',

  // Other
  'westmidlands': 'UK West Midlands',
  'westeurope': 'Western Europe',
  'westcoast': 'West Coast (US or other)',
} as const;

export type AkashRegion = keyof typeof AKASH_REGIONS;

/** Provider facility types */
export const AKASH_LOCATION_TYPES = {
  'datacenter': 'Professional datacenter with enterprise-grade infrastructure',
  'colo': 'Co-location facility (shared datacenter space)',
  'home': 'Home-based server (residential location)',
  'office': 'Office-based server (business location)',
  'server-room': 'Dedicated server room within an organization',
  'mix': 'Mix of multiple location types',
} as const;

export type AkashLocationType = keyof typeof AKASH_LOCATION_TYPES;

/** Provider service tier classifications */
export const AKASH_TIERS = {
  'community': 'Community-tier providers (standard pricing, good for most workloads)',
  'premium': 'Premium-tier providers (higher SLA, enterprise support)',
} as const;

export type AkashTier = keyof typeof AKASH_TIERS;

/** Timezone identifiers (UTC offsets) - rarely used by providers */
export const AKASH_TIMEZONES = {
  'utc-12': 'UTC-12 (Baker Island)',
  'utc-11': 'UTC-11 (American Samoa)',
  'utc-10': 'UTC-10 (Hawaii)',
  'utc-9': 'UTC-9 (Alaska)',
  'utc-8': 'UTC-8 (Pacific Time)',
  'utc-7': 'UTC-7 (Mountain Time)',
  'utc-6': 'UTC-6 (Central Time)',
  'utc-5': 'UTC-5 (Eastern Time)',
  'utc-4': 'UTC-4 (Atlantic Time)',
  'utc-3': 'UTC-3 (Argentina, Brazil)',
  'utc-2': 'UTC-2 (Mid-Atlantic)',
  'utc-1': 'UTC-1 (Azores)',
  'utc+0': 'UTC+0 (GMT, London)',
  'utc+1': 'UTC+1 (Central European Time)',
  'utc+2': 'UTC+2 (Eastern European Time)',
  'utc+3': 'UTC+3 (Moscow)',
  'utc+4': 'UTC+4 (Dubai)',
  'utc+5': 'UTC+5 (Pakistan)',
  'utc+5-30': 'UTC+5:30 (India)',
  'utc+6': 'UTC+6 (Bangladesh)',
  'utc+7': 'UTC+7 (Bangkok)',
  'utc+8': 'UTC+8 (China, Singapore)',
  'utc+9': 'UTC+9 (Japan, Korea)',
  'utc+10': 'UTC+10 (Australia East)',
  'utc+11': 'UTC+11 (Solomon Islands)',
  'utc+12': 'UTC+12 (New Zealand)',
  'utc+13': 'UTC+13 (Tonga)',
  'utc+14': 'UTC+14 (Line Islands)',
} as const;

export type AkashTimezone = keyof typeof AKASH_TIMEZONES;

/** Get all region keys as array */
export function getAkashRegions(): readonly AkashRegion[] {
  return Object.keys(AKASH_REGIONS) as AkashRegion[];
}

/** Get all location type keys as array */
export function getAkashLocationTypes(): readonly AkashLocationType[] {
  return Object.keys(AKASH_LOCATION_TYPES) as AkashLocationType[];
}

/** Get all timezone keys as array */
export function getAkashTimezones(): readonly AkashTimezone[] {
  return Object.keys(AKASH_TIMEZONES) as AkashTimezone[];
}

/** Get all tier keys as array */
export function getAkashTiers(): readonly AkashTier[] {
  return Object.keys(AKASH_TIERS) as AkashTier[];
}

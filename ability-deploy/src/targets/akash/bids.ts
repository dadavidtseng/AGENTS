/**
 * Provider Bid Management
 *
 * Types, pricing calculations, and selection strategies for choosing providers
 * based on cost, reliability, and other criteria.
 *
 * Key responsibilities:
 * - Calculate bid pricing across multiple time periods (hour, day, week, month)
 * - Convert prices between currencies (uAKT, AKT, USD)
 * - Provide selection strategies (cheapest, most reliable, balanced)
 * - Filter bids by criteria (price, uptime, audit status, location)
 *
 * @module targets/akash/bids
 */

import type { ProviderBid } from './client.js';
import type { ProviderInfo } from './types.js';

// Re-export ProviderBid for consumers
export type { ProviderBid };

// ========================================
// Constants
// ========================================

/** Average block time on Akash Network (empirically determined, matches Akash Console) */
const AVERAGE_BLOCK_TIME_SECONDS = 6.098;

/** Average days in a month (365.25 / 12) for accurate monthly cost estimates */
const AVERAGE_DAYS_IN_MONTH = 30.437;

/** Conversion factor: 1 AKT = 1,000,000 uAKT */
const UAKT_PER_AKT = 1_000_000;

// ========================================
// Type Definitions
// ========================================

/**
 * Bid pricing across multiple time periods (block/hour/day/week/month) and
 * currencies (uAKT/AKT/USD). All prices derived from raw per-block price.
 */
export interface BidPricing {
  readonly raw: {
    readonly denom: string;
    readonly amount: string;
  };
  readonly uakt: {
    readonly perBlock: number;
    readonly perHour: number;
    readonly perDay: number;
    readonly perWeek: number;
    readonly perMonth: number;
  };
  readonly akt: {
    readonly perBlock: number;
    readonly perHour: number;
    readonly perDay: number;
    readonly perWeek: number;
    readonly perMonth: number;
  };
  /**
   * Convert to USD. You provide the AKT price (library stays dependency-free).
   * Get price from CoinGecko, your oracle, or hardcode for estimates.
   */
  toUSD(aktPriceUSD: number): {
    readonly perHour: number;
    readonly perDay: number;
    readonly perWeek: number;
    readonly perMonth: number;
  };
}

/**
   * Provider bid enriched with pricing calculations and provider metadata.
   * Wraps raw blockchain bid (ProviderBid) with pre-calculated data for 
   * bid selection.
  */
export interface EnhancedBid {
  /** Unique ID from bid coordinates (owner/dseq/gseq/oseq/provider) */
  readonly id: string;
  /** Raw blockchain bid data */
  readonly bid: ProviderBid;
  /** Provider info (may have undefined fields for incomplete metadata) */
  readonly provider: ProviderInfo;
  /** Pre-calculated pricing across all time periods */
  readonly pricing: BidPricing;
  /** When the provider submitted this bid */
  readonly createdAt: Date;
}

/**
 * Function that selects a bid from available options.
 * Return null if no acceptable bid found.
 */
export type BidSelector =
  | ((bids: EnhancedBid[]) => Promise<EnhancedBid | null>)
  | ((bids: EnhancedBid[]) => EnhancedBid | null);

// ========================================
// Pricing Functions
// ========================================

/**
 * Create BidPricing from blockchain price data.
 * Calculates all time-period prices from the raw per-block price.
 */
export function createBidPricing(price: {
  denom: string;
  amount: string;
}): BidPricing {
  // Parse raw price per block
  const pricePerBlock = parseFloat(price.amount);

  // Calculate number of blocks for each time period
  const blocksPerHour = (60 * 60) / AVERAGE_BLOCK_TIME_SECONDS;
  const blocksPerDay = (24 * 60 * 60) / AVERAGE_BLOCK_TIME_SECONDS;
  const blocksPerWeek = (7 * 24 * 60 * 60) / AVERAGE_BLOCK_TIME_SECONDS;
  const blocksPerMonth = (AVERAGE_DAYS_IN_MONTH * 24 * 60 * 60) / AVERAGE_BLOCK_TIME_SECONDS;

  // Calculate prices in uAKT for all time periods
  const uaktPricing = {
    perBlock: pricePerBlock,
    perHour: pricePerBlock * blocksPerHour,
    perDay: pricePerBlock * blocksPerDay,
    perWeek: pricePerBlock * blocksPerWeek,
    perMonth: pricePerBlock * blocksPerMonth,
  };

  // Calculate prices in AKT (divide uAKT by 1,000,000)
  const aktPricing = {
    perBlock: uaktPricing.perBlock / UAKT_PER_AKT,
    perHour: uaktPricing.perHour / UAKT_PER_AKT,
    perDay: uaktPricing.perDay / UAKT_PER_AKT,
    perWeek: uaktPricing.perWeek / UAKT_PER_AKT,
    perMonth: uaktPricing.perMonth / UAKT_PER_AKT,
  };

  // Return pricing object with USD conversion method
  return {
    raw: {
      denom: price.denom,
      amount: price.amount,
    },
    uakt: uaktPricing,
    akt: aktPricing,
    toUSD: (aktPriceUSD: number) => ({
      perHour: aktPricing.perHour * aktPriceUSD,
      perDay: aktPricing.perDay * aktPriceUSD,
      perWeek: aktPricing.perWeek * aktPriceUSD,
      perMonth: aktPricing.perMonth * aktPriceUSD,
    }),
  };
}

// ========================================
// Selection Strategies
// ========================================

/**
 * Select the cheapest bid by monthly price.
 * For production, consider filtering for quality first (see filterBids).
 *
 * @example
 * ```typescript
 * const result = await deployToAkash({
 *   bidSelector: selectCheapestBid
 * });
 * ```
 */
export function selectCheapestBid(bids: EnhancedBid[]): EnhancedBid | null {
  if (bids.length === 0) return null;

  return bids.reduce((cheapest, current) =>
    current.pricing.uakt.perMonth < cheapest.pricing.uakt.perMonth
      ? current
      : cheapest
  );
}

/**
 * Select the most reliable provider by uptime percentage.
 * Providers without reliability data are excluded.
 *
 * @param bids - Available bids
 * @param period - Uptime period to evaluate (default: 7d)
 *
 * @example
 * ```typescript
 * const result = await deployToAkash({
 *   bidSelector: (bids) => selectMostReliableBid(bids, '30d')
 * });
 * ```
 */
export function selectMostReliableBid(
  bids: EnhancedBid[],
  period: '1d' | '7d' | '30d' = '7d'
): EnhancedBid | null {
  if (bids.length === 0) return null;

  // Filter bids that have reliability data
  const withReliability = bids.filter(
    (bid) => bid.provider.reliability !== undefined
  );

  // If no providers have reliability data, return first bid
  if (withReliability.length === 0) {
    return bids[0] ?? null;
  }

  // Determine uptime key based on period
  const uptimeKey = `uptime${period}` as const;

  // Find provider with highest uptime
  return withReliability.reduce((best, current) => {
    const bestUptime = best.provider.reliability![uptimeKey];
    const currentUptime = current.provider.reliability![uptimeKey];
    return currentUptime > bestUptime ? current : best;
  });
}

/**
 * Select bid using balanced scoring (price + reliability weighted).
 * Default: 50/50 balance. Customize weights for your priorities.
 *
 * @param bids - Available bids
 * @param weights - Scoring weights (default: 0.5 price, 0.5 reliability)
 *
 * @example Equal balance
 * ```typescript
 * const result = await deployToAkash({
 *   bidSelector: selectBalancedBid // 50/50
 * });
 * ```
 *
 * @example Prioritize reliability
 * ```typescript
 * const result = await deployToAkash({
 *   bidSelector: (bids) => selectBalancedBid(bids, {
 *     price: 0.3,
 *     reliability: 0.7
 *   })
 * });
 * ```
 */
export function selectBalancedBid(
  bids: EnhancedBid[],
  weights: { price: number; reliability: number } = { price: 0.5, reliability: 0.5 }
): EnhancedBid | null {
  if (bids.length === 0) return null;

  // Calculate price range for normalization
  const prices = bids.map((bid) => bid.pricing.uakt.perMonth);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;

  // Calculate scores for each bid
  const scored = bids.map((bid) => {
    // Price score: 1.0 for cheapest, 0.0 for most expensive
    // Handle case where all bids have same price
    const priceScore =
      priceRange === 0
        ? 1.0
        : 1.0 - (bid.pricing.uakt.perMonth - minPrice) / priceRange;

    // Reliability score: uptime7d (0.0 to 1.0)
    // Default to 0.5 if no reliability data available
    const reliabilityScore = bid.provider.reliability?.uptime7d ?? 0.5;

    // Weighted total score
    const totalScore =
      priceScore * weights.price + reliabilityScore * weights.reliability;

    return { bid, score: totalScore };
  });

  // Return bid with highest score
  return scored.reduce((best, current) =>
    current.score > best.score ? current : best
  ).bid;
}

/**
 * Filter bids by multiple criteria (price, reliability, audit, location, online status).
 * All criteria are optional. Multiple criteria use AND logic.
 *
 * Use this to establish minimum quality standards, then apply a selection strategy.
 *
 * @param bids - Bids to filter
 * @param criteria - Filter criteria (all optional)
 *
 * @example Filter by price and uptime
 * ```typescript
 * const result = await deployToAkash({
 *   bidSelector: (bids) => {
 *     const filtered = filterBids(bids, {
 *       maxPricePerMonth: { usd: 50, aktPrice: 0.45 },
 *       minUptime: { value: 0.95, period: '7d' }
 *     });
 *     return selectCheapestBid(filtered);
 *   }
 * });
 * ```
 *
 * @example Filter by audit and location
 * ```typescript
 * const filtered = filterBids(bids, {
 *   requireAudited: true,
 *   preferredRegions: ['US', 'EU'],
 *   requireOnline: true
 * });
 * ```
 */
export function filterBids(
  bids: EnhancedBid[],
  criteria: {
    readonly maxPricePerMonth?:
      | { uakt: number }
      | { usd: number; aktPrice: number };
    readonly minUptime?: { value: number; period: '1d' | '7d' | '30d' };
    readonly requireAudited?: boolean;
    readonly preferredRegions?: string[];
    readonly requireOnline?: boolean;
  }
): EnhancedBid[] {
  return bids.filter((bid) => {
    // Price filter
    if (criteria.maxPricePerMonth) {
      const maxPrice = 'uakt' in criteria.maxPricePerMonth
        ? criteria.maxPricePerMonth.uakt
        : bid.pricing.toUSD(criteria.maxPricePerMonth.aktPrice).perMonth;

      const bidPrice = 'uakt' in criteria.maxPricePerMonth
        ? bid.pricing.uakt.perMonth
        : bid.pricing.toUSD(criteria.maxPricePerMonth.aktPrice).perMonth;

      if (bidPrice > maxPrice) return false;
    }

    // Uptime filter
    if (criteria.minUptime) {
      const { value, period } = criteria.minUptime;
      const uptimeKey = `uptime${period}` as const;
      const uptime = bid.provider.reliability?.[uptimeKey];

      // If no reliability data, exclude this bid
      if (uptime === undefined || uptime < value) return false;
    }

    // Audit status filter
    if (criteria.requireAudited && !bid.provider.isAudited) {
      return false;
    }

    // Region filter
    if (criteria.preferredRegions && criteria.preferredRegions.length > 0) {
      const countryCode = bid.provider.location?.countryCode;
      if (!countryCode || !criteria.preferredRegions.includes(countryCode)) {
        return false;
      }
    }

    // Online status filter
    if (criteria.requireOnline) {
      const isOnline = bid.provider.reliability?.isOnline;
      if (isOnline !== true) return false;
    }

    // All filters passed
    return true;
  });
}

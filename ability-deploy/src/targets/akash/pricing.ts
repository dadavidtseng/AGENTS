/**
 * Akash Lease Pricing Utilities
 *
 * Price calculations for Akash Network deployments using the same formulas as
 * Akash Console. Converts per-block prices to human-readable formats (hour/month)
 * and supports USD conversion.
 *
 * @module targets/akash/pricing
 */

/** Average block time on Akash Network (empirically determined) */
export const AVERAGE_BLOCK_TIME_SECONDS = 6.098;

/** Average days in a month (365.25 / 12) for accurate monthly estimates */
export const AVERAGE_DAYS_IN_MONTH = 30.437;

/** Conversion factor: 1 AKT = 1,000,000 uAKT */
export const UAKT_PER_AKT = 1_000_000;

/**
 * Lease price with multiple time periods (block/hour/month) and currencies (uAKT/AKT/USD).
 * All prices derived from blockchain's raw per-block price.
 */
export class LeasePrice {
  public readonly perBlock: {
    readonly denom: string;
    readonly amount: string;
  };

  public readonly uakt: {
    readonly perBlock: number;
    readonly perHour: number;
    readonly perMonth: number;
  };

  public readonly akt: {
    readonly perBlock: number;
    readonly perHour: number;
    readonly perMonth: number;
  };

  constructor(price: { denom: string; amount: string }) {
    this.perBlock = {
      denom: price.denom,
      amount: price.amount,
    };

    const pricePerBlock = parseFloat(price.amount);
    const blocksPerHour = (60 * 60) / AVERAGE_BLOCK_TIME_SECONDS;
    const blocksPerMonth = (AVERAGE_DAYS_IN_MONTH * 24 * 60 * 60) / AVERAGE_BLOCK_TIME_SECONDS;

    this.uakt = {
      perBlock: pricePerBlock,
      perHour: pricePerBlock * blocksPerHour,
      perMonth: pricePerBlock * blocksPerMonth,
    };

    this.akt = {
      perBlock: pricePerBlock / UAKT_PER_AKT,
      perHour: this.uakt.perHour / UAKT_PER_AKT,
      perMonth: this.uakt.perMonth / UAKT_PER_AKT,
    };
  }

  /**
   * Convert to USD. You provide the AKT price (library stays dependency-free).
   * Get AKT price from CoinGecko, your oracle, or hardcode for estimates.
   */
  toUSD(aktPriceUSD: number): {
    readonly perBlock: number;
    readonly perHour: number;
    readonly perMonth: number;
  } {
    return {
      perBlock: this.akt.perBlock * aktPriceUSD,
      perHour: this.akt.perHour * aktPriceUSD,
      perMonth: this.akt.perMonth * aktPriceUSD,
    };
  }

  /** Get formatted pricing summary */
  toJSON() {
    return {
      perBlock: this.perBlock,
      uakt: this.uakt,
      akt: this.akt,
    };
  }

  /** Create LeasePrice from uAKT amount (convenience method) */
  static fromUakt(amountUakt: number): LeasePrice {
    return new LeasePrice({
      denom: 'uakt',
      amount: String(amountUakt),
    });
  }
}

/**
 * Package constants
 *
 * @module constants
 */

/**
 * Package version
 */
export const VERSION = '1.0.0';

/**
 * Package name
 */
export const PACKAGE_NAME = 'deploy-ability';

/**
 * Default timeout values (in milliseconds)
 */
export const DEFAULT_TIMEOUTS = {
  /** Timeout for waiting for lease creation */
  LEASE: 300_000, // 5 minutes

  /** Timeout for waiting for containers to start */
  CONTAINER: 600_000, // 10 minutes

  /** Timeout for provider communication */
  PROVIDER: 30_000, // 30 seconds

  /** Timeout for wallet connection */
  WALLET: 60_000, // 1 minute
} as const;

/**
 * Default polling intervals (in milliseconds)
 */
export const DEFAULT_INTERVALS = {
  /** Interval for checking container status */
  CONTAINER_STATUS: 5_000, // 5 seconds

  /** Interval for checking lease status */
  LEASE_STATUS: 3_000, // 3 seconds

  /** Interval for checking provider status */
  PROVIDER_STATUS: 2_000, // 2 seconds
} as const;

/**
 * Default network configurations
 */
export const NETWORK_CONFIGS = {
  mainnet: {
    chainId: 'akashnet-2',
    rpcEndpoint: 'https://rpc.akashnet.net:443',
    restEndpoint: 'https://api.akashnet.net:443',
  },
  testnet: {
    chainId: 'sandbox-01',
    rpcEndpoint: 'https://rpc.sandbox-01.aksh.pw:443',
    restEndpoint: 'https://api.sandbox-01.aksh.pw:443',
  },
  sandbox: {
    chainId: 'sandbox-01',
    rpcEndpoint: 'https://rpc.sandbox-01.aksh.pw:443',
    restEndpoint: 'https://api.sandbox-01.aksh.pw:443',
  },
} as const;

/**
 * Default certificate path
 */
export const DEFAULT_CERT_PATH = '~/.akash/certificate.json';

/**
 * Default Docker network name
 */
export const DEFAULT_DOCKER_NETWORK = 'kadi-net';

/**
 * Default compose file name
 */
export const DEFAULT_COMPOSE_FILE = 'docker-compose.yml';

/**
 * Minimum deployment deposit in uAKT
 */
export const MIN_DEPOSIT = 5_000_000; // 5 AKT

/**
 * Gas prices for transactions
 */
export const GAS_PRICES = {
  low: '0.025uakt',
  average: '0.03uakt',
  high: '0.04uakt',
} as const;

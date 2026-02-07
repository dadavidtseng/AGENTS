/**
 * Akash Network Wallet Connection Module
 *
 * Provides a clean, step-by-step API for connecting to Keplr wallet via WalletConnect.
 * This is a LIBRARY - no QR code display, no prompts, just pure wallet operations.
 *
 * @module targets/akash/wallet
 */

import { SignClient } from '@walletconnect/sign-client';
import { KeplrWalletConnectV2 } from '@keplr-wallet/wc-client';
import { fromHex } from '@cosmjs/encoding';
import { StargateClient } from '@cosmjs/stargate';
import type { SessionTypes } from '@walletconnect/types';

import type { Result } from '../../types/index.js';
import type { WalletContext, AccountData } from './types.js';
import { WalletError, WalletErrorCodes, getErrorMessage } from '../../errors/index.js';
import { getNetworkConfig, type AkashNetwork } from './environment.js';

/** WalletConnect client wrapper */
export interface WalletConnectClient {
  readonly client: InstanceType<typeof SignClient>;
  readonly metadata: {
    readonly name: string;
    readonly description: string;
    readonly url: string;
    readonly icons: readonly string[];
  };
}

/** Connection URI result */
export interface ConnectionUriResult {
  readonly uri: string;
  readonly approval: () => Promise<SessionTypes.Struct>;
}

/** Connection approval result */
export interface ApprovalResult {
  readonly session: SessionTypes.Struct;
  readonly address: string;
  readonly chainId: string;
}

/**
 * Step 1: Initialize WalletConnect client
 *
 * @param projectId - WalletConnect Cloud project ID
 * @param metadata - Optional app metadata (defaults to KADI Deploy)
 * @returns Result with WalletConnect client or error
 *
 * @example
 * ```typescript
 * const clientResult = await initWalletConnect('your-project-id-here');
 * if (clientResult.success) {
 *   console.log('WalletConnect ready!');
 * }
 * ```
 */
export async function initWalletConnect(
  projectId: string,
  metadata?: {
    name: string;
    description: string;
    url: string;
    icons: string[];
  }
): Promise<Result<WalletConnectClient, WalletError>> {
  try {
    // Step 1: Validate project ID
    if (!projectId || projectId.trim().length === 0) {
      return {
        success: false,
        error: new WalletError(
          'WalletConnect project ID is required',
          WalletErrorCodes.MISSING_PROJECT_ID,
          { projectId }
        )
      };
    }

    // Step 2: Prepare metadata (use defaults if not provided)
    const appMetadata = metadata || {
      name: 'KADI Deploy',
      description: 'Deploy to Akash Network',
      url: 'https://kadi.build',
      icons: ['https://kadi.build/icon.png']
    };

    // Step 3: Initialize SignClient
    // This creates the WalletConnect client that manages all connections
    const client = await SignClient.init({
      projectId,
      metadata: appMetadata
    });

    // Step 4: Return initialized client
    return {
      success: true,
      data: {
        client,
        metadata: appMetadata
      }
    };
  } catch (error) {
    // Step 5: Handle initialization errors
    const errMsg = getErrorMessage(error);
    return {
      success: false,
      error: new WalletError(
        `Failed to initialize WalletConnect: ${errMsg}`,
        WalletErrorCodes.INIT_FAILED,
        { error: errMsg }
      )
    };
  }
}

/**
 * Step 2: Generate connection URI for QR code display
 *
 * Creates a new pairing and generates the WalletConnect URI.
 * The caller is responsible for displaying this URI as a QR code.
 *
 * @param wcClient - Initialized WalletConnect client from step 1
 * @param network - Akash network to connect to
 * @returns Result with URI and pairing info or error
 *
 * @example
 * ```typescript
 * const uriResult = await generateConnectionUri(wcClient, 'mainnet');
 * if (uriResult.success) {
 *   console.log('Scan this QR code:', uriResult.data.uri);
 * }
 * ```
 */
export async function generateConnectionUri(
  wcClient: WalletConnectClient,
  network: AkashNetwork
): Promise<Result<ConnectionUriResult, WalletError>> {
  try {
    // Step 1: Get network configuration
    const networkConfig = getNetworkConfig(network);
    const chainId = `cosmos:${networkConfig.chainId}`;

    // Step 2: Define optional namespaces for Akash
    // This tells the wallet what permissions we need
    // Using optionalNamespaces (new API) instead of deprecated requiredNamespaces
    const optionalNamespaces = {
      cosmos: {
        chains: [chainId],
        methods: [
          'cosmos_signDirect',    // For transaction signing
          'cosmos_signAmino',     // Legacy signing support
          'cosmos_getAccounts'    // To get wallet address
        ],
        events: []
      }
    };

    // Step 3: Create connection request
    // This generates the URI and starts waiting for approval
    const { uri, approval } = await wcClient.client.connect({
      optionalNamespaces
    });

    // Step 4: Validate URI was generated
    if (!uri) {
      return {
        success: false,
        error: new WalletError(
          'Failed to generate connection URI',
          WalletErrorCodes.URI_GENERATION_FAILED,
          { network }
        )
      };
    }

    // Step 5: Return URI and approval promise
    // This matches the original kadi-deploy behavior
    return {
      success: true,
      data: {
        uri,
        approval
      }
    };
  } catch (error) {
    // Step 7: Handle connection errors
    const errMsg = getErrorMessage(error);
    return {
      success: false,
      error: new WalletError(
        `Failed to generate connection URI: ${errMsg}`,
        WalletErrorCodes.CONNECTION_FAILED,
        { error: errMsg }
      )
    };
  }
}

/**
 * Step 3: Wait for user to approve connection
 *
 * Polls for wallet approval with configurable timeout.
 *
 * @param approval - Approval promise from step 2
 * @param timeoutMs - Maximum wait time in milliseconds (default: 5 minutes)
 * @returns Result with approved session or error
 *
 * @example
 * ```typescript
 * const approvalResult = await waitForApproval(approval, 60000);
 * if (approvalResult.success) {
 *   console.log(`Connected to ${approvalResult.data.address}`);
 * }
 * ```
 */
export async function waitForApproval(
  approval: () => Promise<SessionTypes.Struct>,
  timeoutMs: number = 300000 // 5 minutes default
): Promise<Result<ApprovalResult, WalletError>> {
  try {
    // Step 1: Create timeout promise
    // This races against the approval to implement timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, timeoutMs);
    });

    // Step 2: Race approval against timeout
    // Whichever resolves first wins
    const session = await Promise.race([
      approval(),
      timeoutPromise
    ]) as SessionTypes.Struct;

    // Step 3: Extract account info from session
    // The session contains the connected accounts
    const accounts = session.namespaces.cosmos?.accounts || [];

    if (accounts.length === 0) {
      return {
        success: false,
        error: new WalletError(
          'No accounts found in session',
          WalletErrorCodes.NO_ACCOUNTS,
          { session }
        )
      };
    }

    // Step 4: Parse account address and chain
    // Format: "cosmos:chainid:address"
    const [_namespace, chainId, address] = accounts[0]!.split(':');

    // Validate parsed values
    if (!chainId || !address) {
      return {
        success: false,
        error: new WalletError(
          'Invalid account format in session',
          WalletErrorCodes.ACCOUNT_NOT_FOUND,
          { account: accounts[0] }
        )
      };
    }

    // Step 5: Return approval result
    return {
      success: true,
      data: {
        session,
        address,
        chainId
      }
    };
  } catch (error) {
    // Step 6: Handle timeout or rejection
    const errMsg = getErrorMessage(error);

    if (errMsg.includes('timeout')) {
      return {
        success: false,
        error: new WalletError(
          'Connection approval timed out',
          WalletErrorCodes.APPROVAL_TIMEOUT,
          { timeoutMs }
        )
      };
    }

    if (errMsg.includes('rejected') || errMsg.includes('cancelled')) {
      return {
        success: false,
        error: new WalletError(
          'User rejected connection',
          WalletErrorCodes.APPROVAL_REJECTED,
          {}
        )
      };
    }

    // Step 7: Handle other errors
    return {
      success: false,
      error: new WalletError(
        `Approval failed: ${errMsg}`,
        WalletErrorCodes.APPROVAL_FAILED,
        { error: errMsg }
      )
    };
  }
}

/**
 * Step 4: Create complete wallet context for Akash operations
 *
 * Finalizes the connection by creating signers and querying account data.
 *
 * @param wcClient - WalletConnect client from step 1
 * @param approvalResult - Approval result from step 3
 * @param network - Akash network being used
 * @returns Result with complete wallet context or error
 *
 * @example
 * ```typescript
 * const walletResult = await createWalletContext(wcClient, approvalResult.data, 'mainnet');
 * if (walletResult.success) {
 *   console.log('Wallet ready:', walletResult.data.address);
 * }
 * ```
 */
export async function createWalletContext(
  wcClient: WalletConnectClient,
  approvalResult: ApprovalResult,
  network: AkashNetwork
): Promise<Result<WalletContext, WalletError>> {
  try {
    // Step 1: Get network configuration
    const networkConfig = getNetworkConfig(network);
    const chainId = networkConfig.chainId;

    // Step 2: Create Keplr wallet instance via WalletConnect
    // This wraps the WalletConnect session in a Keplr-compatible interface
    const keplr = new KeplrWalletConnectV2(
      wcClient.client,
      approvalResult.session
    );

    // Step 3: Get offline signer for transaction signing
    // This is the main interface for signing transactions
    // Note: There's a known type incompatibility between @keplr-wallet/types and @cosmjs/proto-signing
    // (SignDoc.accountNumber: Long vs bigint). The runtime objects work fine - this is TypeScript only.
    // We use 'as unknown as' to force the cast since TS knows the types are incompatible.
    const offlineSigner = keplr.getOfflineSigner(chainId) as unknown as WalletContext['signer'];

    // Step 4: Get accounts from signer
    // This should match the approved account
    const accounts = await offlineSigner.getAccounts();

    if (accounts.length === 0) {
      return {
        success: false,
        error: new WalletError(
          'No accounts available from signer',
          WalletErrorCodes.NO_SIGNER_ACCOUNTS,
          { chainId }
        )
      };
    }

    // Step 5: Connect to blockchain to get account details
    // We need account number and sequence for transactions
    const stargateClient = await StargateClient.connect(networkConfig.rpc);

    let accountData: AccountData | undefined;
    try {
      const account = await stargateClient.getAccount(accounts[0]!.address);

      if (account) {
        accountData = {
          address: account.address,
          pubkey: account.pubkey ? fromHex(account.pubkey.value) : null,
          accountNumber: account.accountNumber,
          sequence: account.sequence
        };
      }
    } catch (error) {
      // Account might not exist on chain yet (new account)
      // This is OK - account will be created with first transaction
      accountData = undefined;
    } finally {
      // Step 6: Always disconnect Stargate client
      stargateClient.disconnect();
    }

    // Step 7: Create complete wallet context
    const walletContext: WalletContext = {
      address: accounts[0]!.address,
      signer: offlineSigner,
      offlineSigner: offlineSigner,
      signClient: wcClient.client,
      session: approvalResult.session,
      chainId: chainId,
      account: accountData
    };

    // Step 8: Return ready-to-use wallet
    return {
      success: true,
      data: walletContext
    };
  } catch (error) {
    // Step 9: Handle creation errors
    const errMsg = getErrorMessage(error);
    return {
      success: false,
      error: new WalletError(
        `Failed to create wallet context: ${errMsg}`,
        WalletErrorCodes.CONTEXT_CREATION_FAILED,
        { error: errMsg }
      )
    };
  }
}

/**
 * Create wallet context from any offline signer
 *
 * Use this for automated deployments where you have direct access to a signer (e.g., agent wallet,
 * CI/CD, hardware wallet, KMS). The signer can sign transactions without exposing the underlying key.
 *
 * @param signer - Any offline signer (must implement OfflineAminoSigner & OfflineDirectSigner)
 * @param network - Akash network to connect to
 * @returns Result with wallet context ready for deployments
 *
 * @example
 * ```typescript
 * const agentSigner = await myAgent.wallet.getSigner();
 * const walletCtx = await createWalletContextFromSigner(agentSigner, 'mainnet');
 * if (walletCtx.success) {
 *   await deployToAkash({ wallet: walletCtx.data, ... });
 * }
 * ```
 */
export async function createWalletContextFromSigner(
  signer: WalletContext['signer'],
  network: AkashNetwork
): Promise<Result<WalletContext, WalletError>> {
  try {
    // Step 1: Get network configuration
    const networkConfig = getNetworkConfig(network);

    // Step 2: Get accounts from signer
    // The signer provides accounts without exposing private keys
    const accounts = await signer.getAccounts();

    if (accounts.length === 0) {
      return {
        success: false,
        error: new WalletError(
          'No accounts available from signer',
          WalletErrorCodes.NO_SIGNER_ACCOUNTS,
          { network }
        ),
      };
    }

    const address = accounts[0]!.address;

    // Step 3: Connect to blockchain to get account details
    // We need account number and sequence for transactions
    const stargateClient = await StargateClient.connect(networkConfig.rpc);

    let accountData: AccountData | undefined;
    try {
      const account = await stargateClient.getAccount(address);

      if (account) {
        accountData = {
          address: account.address,
          pubkey: account.pubkey ? fromHex(Buffer.from(account.pubkey.value).toString('hex')) : null,
          accountNumber: account.accountNumber,
          sequence: account.sequence,
        };
      }
    } finally {
      // Always disconnect the query client
      stargateClient.disconnect();
    }

    // Step 4: Create wallet context
    // Note: No WalletConnect client or session - this is for direct signer usage
    const walletContext: WalletContext = {
      address,
      signer,
      offlineSigner: signer,
      chainId: networkConfig.chainId,
      account: accountData,
      // signClient and session are undefined - only used for WalletConnect
    };

    return {
      success: true,
      data: walletContext,
    };
  } catch (error) {
    const errMsg = getErrorMessage(error);
    return {
      success: false,
      error: new WalletError(
        `Failed to create wallet context from signer: ${errMsg}`,
        WalletErrorCodes.CONTEXT_CREATION_FAILED,
        { error: errMsg, network }
      ),
    };
  }
}

/**
 * Disconnect an active WalletConnect session
 *
 * Cleanly disconnects from the wallet and cleans up all internal resources. Always call this
 * when done with wallet operations to allow Node.js event loop to exit.
 *
 * Note: This only applies to WalletConnect sessions. Wallets created with
 * createWalletContextFromSigner() don't need disconnection.
 *
 * @param wallet - Wallet context to disconnect
 * @returns Result indicating success or error
 *
 * @example
 * ```typescript
 * const result = await disconnectWallet(wallet);
 * if (result.success) {
 *   console.log('Wallet disconnected');
 * }
 * ```
 */
export async function disconnectWallet(
  wallet: WalletContext
): Promise<Result<void, WalletError>> {
  try {
    // Step 1: Check if WalletConnect session exists
    if (!wallet.signClient || !wallet.session) {
      // Not a WalletConnect wallet (maybe browser extension)
      return { success: true, data: undefined };
    }

    try {
      // Step 2: Disconnect the session
      await wallet.signClient.disconnect({
        topic: wallet.session.topic,
        reason: {
          code: 1,
          message: 'User disconnected'
        }
      });
    } finally {
      // Step 3: Clean up internal WalletConnect resources
      // This is critical to allow Node.js event loop to exit
      try {
        // Close relay WebSocket transport
        await wallet.signClient.core.relayer.transportClose();
      } catch (err) {
        // Ignore transport close errors
      }

      try {
        // Stop heartbeat timer
        wallet.signClient.core.heartbeat?.stop();
      } catch (err) {
        // Ignore heartbeat stop errors
      }

      try {
        // Remove all event listeners to prevent memory leaks
        // Pass undefined to remove all listeners for all events
        if (wallet.signClient.core.events.removeAllListeners) {
          wallet.signClient.core.events.removeAllListeners(undefined as any);
        }
        if (wallet.signClient.removeAllListeners) {
          wallet.signClient.removeAllListeners(undefined as any);
        }
      } catch (err) {
        // Ignore listener removal errors
      }

      try {
        // Storage cleanup: WalletConnect uses nested storage wrappers.
        // The innermost layer (storage.database.database) has the file watcher
        // that keeps Node.js alive. We must drill down to stop it.
        const storage = (wallet.signClient.core as any)?.storage;
        const innerDb = storage?.database?.database;

        if (innerDb) {
          if (typeof innerDb.unwatch === 'function') {
            await innerDb.unwatch().catch(() => {});
          }
          if (typeof innerDb.dispose === 'function') {
            await innerDb.dispose().catch(() => {});
          }
        }
      } catch (err) {
        // Silently ignore storage cleanup errors during shutdown
      }
    }

    // Step 4: Return success
    return { success: true, data: undefined };
  } catch (error) {
    // Step 5: Handle disconnect errors (non-fatal)
    const errMsg = getErrorMessage(error);
    return {
      success: false,
      error: new WalletError(
        `Failed to disconnect wallet: ${errMsg}`,
        WalletErrorCodes.DISCONNECT_FAILED,
        { error: errMsg }
      )
    };
  }
}

/**
 * Complete wallet connection flow (convenience function)
 *
 * Combines all 4 steps into a single function for simple use cases.
 *
 * @param projectId - WalletConnect project ID
 * @param network - Akash network to connect to
 * @param options - Optional configuration
 * @returns Result with wallet context or error
 *
 * @example
 * ```typescript
 * const walletResult = await connectWallet('your-project-id', 'mainnet', {
 *   onUriGenerated: (uri) => console.log('Scan QR code:', uri),
 *   timeoutMs: 60000
 * });
 * if (walletResult.success) {
 *   console.log('Connected to:', walletResult.data.address);
 * }
 * ```
 */
export async function connectWallet(
  projectId: string,
  network: AkashNetwork,
  options?: {
    /** Callback when URI is generated (for QR display) */
    onUriGenerated?: (uri: string) => void;
    /** Connection timeout in milliseconds */
    timeoutMs?: number;
    /** App metadata */
    metadata?: {
      name: string;
      description: string;
      url: string;
      icons: string[];
    };
  }
): Promise<Result<WalletContext, WalletError>> {
  // Step 1: Initialize WalletConnect
  const clientResult = await initWalletConnect(projectId, options?.metadata);
  if (!clientResult.success) {
    return clientResult;
  }

  // Step 2: Generate connection URI
  const uriResult = await generateConnectionUri(clientResult.data, network);
  if (!uriResult.success) {
    return uriResult;
  }

  // Step 3: Notify caller of URI (for QR display)
  if (options?.onUriGenerated) {
    options.onUriGenerated(uriResult.data.uri);
  }

  // Step 4: Wait for approval
  const approvalResult = await waitForApproval(
    uriResult.data.approval,
    options?.timeoutMs
  );
  if (!approvalResult.success) {
    return approvalResult;
  }

  // Step 5: Create wallet context
  return createWalletContext(clientResult.data, approvalResult.data, network);
}

/**
 * Create wallet context from mnemonic (for agent-controlled wallets)
 *
 * **SECURITY WARNING:** Only use this for automation YOU control (CI/CD, your own agents).
 * For third-party services, use connectWallet() with WalletConnect instead to avoid
 * exposing your mnemonic.
 *
 * @param mnemonic - BIP39 mnemonic phrase (12 or 24 words)
 * @param network - Akash network to connect to
 * @returns Result with wallet context or error
 *
 * @example
 * ```typescript
 * const mnemonic = process.env.DEPLOYMENT_WALLET_MNEMONIC!;
 * const wallet = await createWalletFromMnemonic(mnemonic, 'mainnet');
 * if (wallet.success) {
 *   await deployToAkash({ wallet: wallet.data, ... });
 * }
 * ```
 */
export async function createWalletFromMnemonic(
  _mnemonic: string,
  network: AkashNetwork
): Promise<Result<WalletContext, WalletError>> {
  // TODO: Implement using DirectSecp256k1HdWallet from @cosmjs/proto-signing
  return {
    success: false,
    error: new WalletError(
      'createWalletFromMnemonic() not yet implemented',
      WalletErrorCodes.NOT_IMPLEMENTED,
      { network }
    ),
  };
}
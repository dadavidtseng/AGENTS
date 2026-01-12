/**
 * Generate a new testnet wallet and get free AKT from faucet
 * 
 * Usage:
 *   node setup-testnet-wallet.js
 * 
 * This will:
 * 1. Generate a new random wallet mnemonic
 * 2. Display the mnemonic and address
 * 3. Provide instructions to get testnet AKT from faucet
 * 4. Update .env file with the mnemonic
 */

const bip39 = require('bip39');
const { DirectSecp256k1HdWallet } = require('@cosmjs/proto-signing');
const fs = require('fs');
const path = require('path');

async function setupTestnetWallet() {
  console.log('🔐 Generating new Akash testnet wallet...\n');

  // Generate a new 24-word mnemonic
  const mnemonic = bip39.generateMnemonic(256);
  
  // Create wallet from mnemonic
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'akash',
  });

  // Get the first account
  const [account] = await wallet.getAccounts();
  const address = account.address;

  console.log('✅ Wallet generated successfully!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔑 MNEMONIC (24 words):');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(mnemonic);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('📬 Your Akash Testnet Address:');
  console.log(address);
  console.log('');

  console.log('💰 NEXT STEP: Get Free Testnet AKT\n');
  console.log('Option 1 - Discord Faucet (Recommended):');
  console.log('  1. Join Akash Discord: https://discord.gg/akash');
  console.log('  2. Go to #faucet channel');
  console.log(`  3. Type: /faucet ${address}`);
  console.log('  4. Wait for confirmation (usually instant)\n');
  
  console.log('Option 2 - Web Faucet:');
  console.log('  1. Visit: https://faucet.sandbox-01.aksh.pw/');
  console.log(`  2. Enter address: ${address}`);
  console.log('  3. Click "Request Tokens"\n');

  // Update .env file
  const envPath = path.join(__dirname, '.env');
  let envContent = '';

  // Read existing .env if it exists
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
    
    // Check if AKASH_WALLET_MNEMONIC already exists (commented or not)
    if (envContent.includes('AKASH_WALLET_MNEMONIC=')) {
      // Replace existing line
      envContent = envContent.replace(
        /# ?AKASH_WALLET_MNEMONIC=.*/g,
        `AKASH_WALLET_MNEMONIC=${mnemonic}`
      );
    } else {
      // Add new line
      envContent += `\n# Wallet Mnemonic (Generated: ${new Date().toISOString()})\nAKASH_WALLET_MNEMONIC=${mnemonic}\n`;
    }
  } else {
    // Create new .env file with testnet configuration
    envContent = `# Akash Testnet Configuration
# Generated: ${new Date().toISOString()}

# Akash Testnet RPC Endpoint
AKASH_RPC_ENDPOINT=https://rpc.sandbox-01.aksh.pw:443

# Akash Testnet API Endpoint
AKASH_API_ENDPOINT=https://api.sandbox-01.aksh.pw

# Akash Testnet Chain ID
AKASH_CHAIN_ID=sandbox-01

# Wallet Mnemonic (Autonomous Mode)
AKASH_WALLET_MNEMONIC=${mnemonic}
`;
  }

  fs.writeFileSync(envPath, envContent);

  console.log('✅ .env file updated with your mnemonic\n');
  console.log('⚠️  SECURITY NOTE:');
  console.log('   - This is a TESTNET wallet (no real funds)');
  console.log('   - Keep the mnemonic private');
  console.log('   - Never use this mnemonic for mainnet\n');

  console.log('🚀 READY TO DEPLOY!\n');
  console.log('After getting testnet AKT from faucet, run:');
  console.log('   node test-deploy-akash.js --dry-run   # Validate first');
  console.log('   node test-deploy-akash.js             # Real deployment');
  console.log('');

  return {
    mnemonic,
    address,
  };
}

// Run the setup
setupTestnetWallet().catch((error) => {
  console.error('❌ Error setting up wallet:', error.message);
  console.error(error.stack);
  process.exit(1);
});

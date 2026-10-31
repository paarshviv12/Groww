// Creates two brand-new wallets and saves their keys to ../.env.mainnet on THIS machine only.
// It prints addresses, never keys. Do not commit or share that file.
//   node scripts/make-wallets.mjs
import { existsSync, writeFileSync, chmodSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const file = new URL("../../.env.mainnet", import.meta.url);
if (existsSync(file)) {
  console.log("../.env.mainnet already exists. Delete it first if you really want new wallets.");
  process.exit(1);
}
const agent = generatePrivateKey();
const merchant = generatePrivateKey();
const relayer = generatePrivateKey();
const ra = privateKeyToAccount(relayer).address;
// The key GROWW signs carts with (ES256K / secp256k1). Keep it stable so old pay links stay valid.
const cartPem = generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim().replace(/\n/g, "\\n");
const aa = privateKeyToAccount(agent).address;
const ma = privateKeyToAccount(merchant).address;

writeFileSync(file, [
  "# GROWW mainnet wallets. Keep this file private. Never commit it.",
  `AGENT_KEY=${agent}`,
  `DEPLOYER_KEY=${agent}`,
  `RELAYER_KEY=${relayer}`,
  `MERCHANT_PRIVATE_KEY_PEM='${cartPem}'`,
  `MERCHANT_PAY_TO=${ma}`,
  `# The demo merchant wallet only receives money; its key was discarded.`,
  "NETWORK=mainnet",
  "",
].join("\n"), { mode: 0o600 });
try { chmodSync(file, 0o600); } catch {}

console.log("\nTwo new wallets created.\n");
console.log(`Agent wallet (send funds HERE): ${aa}`);
console.log(`Relayer wallet (gas only, needs ~0.05 HSK, NO USDC): ${ra}`);
console.log(`Demo merchant wallet (receives only): ${ma}`);
console.log("\nThe agent wallet deploys the contract and pays in the demo. It needs, on HashKey Chain (chain 177):");
console.log("  - about 0.05 HSK for gas");
console.log("  - about 2 USDC.e (token 0x054ed45810DbBAb8B27668922D110669c9D88D0a)");
console.log("\nThen run: npx tsx scripts/preflight.mts\n");

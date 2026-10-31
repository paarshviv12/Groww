import hre from "hardhat";
import * as fs from "fs";

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const pc = await hre.viem.getPublicClient();
  const chainId = await pc.getChainId();
  const bal = await pc.getBalance({ address: deployer.account.address });
  console.log(`network=${hre.network.name} chainId=${chainId} deployer=${deployer.account.address} balance=${bal} wei`);
  if (bal === 0n) throw new Error("deployer has no HSK for gas");

  const settler = await hre.viem.deployContract("MandateSettler");
  const deployBlock = (await pc.getBlockNumber()).toString();
  const out: Record<string, unknown> = {
    network: hre.network.name, chainId, settler: settler.address, deployer: deployer.account.address,
    deployBlock, deployedAt: new Date().toISOString(),
  };
  if (["hardhat", "localhost"].includes(hre.network.name)) {
    const token = await hre.viem.deployContract("MockUSDC3009");
    await token.write.mint([deployer.account.address, 10_000_000n]);
    out.usdc = token.address;
  }
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(`deployments/${hre.network.name}.json`, JSON.stringify(out, null, 2));
  console.log(out);
}
main().catch((e) => { console.error(e); process.exit(1); });

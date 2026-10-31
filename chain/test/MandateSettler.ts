import { expect } from "chai";
import hre from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { parseSignature, keccak256, toHex, type Hex, type Address } from "viem";

const AMOUNT = 20_000n; // 0.02 USDC (6 decimals)

async function fixture() {
  const [deployer, payer, payee, relayer, mallory] = await hre.viem.getWalletClients();
  const token = await hre.viem.deployContract("MockUSDC3009");
  const settler = await hre.viem.deployContract("MandateSettler");
  await token.write.mint([payer.account.address, 1_000_000n]);
  const pc = await hre.viem.getPublicClient();
  const chainId = await pc.getChainId();
  const now = BigInt(await time.latest());
  const cartHash = keccak256(toHex("cart-001")) as Hex;
  const mandate = (over: Partial<{ cartHash: Hex; payee: Address; amount: bigint; cartExpiry: bigint }> = {}) => ({
    cartHash,
    token: token.address,
    payee: payee.account.address,
    amount: AMOUNT,
    cartExpiry: now + 7200n,
    ...over,
  });

  async function sign(opts: { nonce: Hex; value?: bigint; to?: Address; validBefore?: bigint; signer?: typeof payer }) {
    const s = opts.signer ?? payer;
    const message = {
      from: s.account.address,
      to: opts.to ?? settler.address,
      value: opts.value ?? AMOUNT,
      validAfter: 0n,
      validBefore: opts.validBefore ?? now + 3600n,
      nonce: opts.nonce,
    };
    const signature = await s.signTypedData({
      domain: { name: "Bridged USDC", version: "2", chainId, verifyingContract: token.address },
      types: {
        ReceiveWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "ReceiveWithAuthorization",
      message,
    });
    const p = parseSignature(signature);
    const v = Number(p.v ?? BigInt(27 + (p.yParity ?? 0)));
    return { message, v, r: p.r, s: p.s };
  }

  const auth = (sig: { message: { validBefore: bigint }; v: number; r: Hex; s: Hex }) => ({
    validAfter: 0n,
    validBefore: sig.message.validBefore,
    v: sig.v,
    r: sig.r,
    s: sig.s,
  });

  return { auth, deployer, payer, payee, relayer, mallory, token, settler, pc, now, cartHash, mandate, sign };
}

describe("MandateSettler", () => {
  it("settles a signed mandate, gaslessly for the payer, and records the receipt", async () => {
    const f = await loadFixture(fixture);
    const auth = f.auth;
    const m = f.mandate();
    const nonce = await f.settler.read.authNonceFor([m.cartHash, m.payee]);
    const sig = await f.sign({ nonce });

    await f.settler.write.settle(
      [m, f.payer.account.address, auth(sig)],
      { account: f.relayer.account }, // a relayer pays gas, not the payer
    );

    expect(await f.token.read.balanceOf([f.payee.account.address])).to.equal(AMOUNT);
    expect(await f.token.read.balanceOf([f.payer.account.address])).to.equal(1_000_000n - AMOUNT);
    expect(await f.token.read.balanceOf([f.settler.address])).to.equal(0n);
    expect(await f.settler.read.isSettled([m.cartHash])).to.equal(true);
    const events = await f.settler.getEvents.MandateSettled();
    expect(events).to.have.length(1);
    expect(events[0].args.cartHash).to.equal(m.cartHash);
    expect(events[0].args.amount).to.equal(AMOUNT);
  });

  it("rejects a replay of the same cart", async () => {
    const f = await loadFixture(fixture);
    const auth = f.auth;
    const m = f.mandate();
    const nonce = await f.settler.read.authNonceFor([m.cartHash, m.payee]);
    const sig = await f.sign({ nonce });
    const args = [m, f.payer.account.address, auth(sig)] as const;
    await f.settler.write.settle(args);
    await expect(f.settler.write.settle(args)).to.be.rejectedWith("AlreadySettled");
  });

  it("rejects a redirected payee (signature was bound to the original payee)", async () => {
    const f = await loadFixture(fixture);
    const auth = f.auth;
    const m = f.mandate();
    const nonce = await f.settler.read.authNonceFor([m.cartHash, m.payee]);
    const sig = await f.sign({ nonce });
    const evil = f.mandate({ payee: f.mallory.account.address });
    await expect(
      f.settler.write.settle([evil, f.payer.account.address, auth(sig)]),
    ).to.be.rejectedWith("invalid signature");
  });

  it("rejects an inflated amount", async () => {
    const f = await loadFixture(fixture);
    const auth = f.auth;
    const m = f.mandate();
    const nonce = await f.settler.read.authNonceFor([m.cartHash, m.payee]);
    const sig = await f.sign({ nonce });
    await expect(
      f.settler.write.settle([
        f.mandate({ amount: AMOUNT * 10n }),
        f.payer.account.address, auth(sig),
      ]),
    ).to.be.rejectedWith("invalid signature");
  });

  it("rejects a signature made for a different cart", async () => {
    const f = await loadFixture(fixture);
    const auth = f.auth;
    const m = f.mandate();
    const otherNonce = await f.settler.read.authNonceFor([keccak256(toHex("cart-002")) as Hex, m.payee]);
    const sig = await f.sign({ nonce: otherNonce });
    await expect(
      f.settler.write.settle([m, f.payer.account.address, auth(sig)]),
    ).to.be.rejectedWith("invalid signature");
  });

  it("rejects a signature from someone other than the stated payer", async () => {
    const f = await loadFixture(fixture);
    const auth = f.auth;
    const m = f.mandate();
    const nonce = await f.settler.read.authNonceFor([m.cartHash, m.payee]);
    const sig = await f.sign({ nonce, signer: f.mallory });
    await expect(
      f.settler.write.settle([m, f.payer.account.address, auth(sig)]),
    ).to.be.rejectedWith("invalid signature");
  });

  it("rejects an expired cart", async () => {
    const f = await loadFixture(fixture);
    const auth = f.auth;
    const m = f.mandate();
    const nonce = await f.settler.read.authNonceFor([m.cartHash, m.payee]);
    const sig = await f.sign({ nonce, validBefore: f.now + 100_000n });
    await time.increase(7300);
    await expect(
      f.settler.write.settle([m, f.payer.account.address, auth(sig)]),
    ).to.be.rejectedWith("CartExpired");
  });

  it("rejects an expired wallet authorization even if the cart is still valid", async () => {
    const f = await loadFixture(fixture);
    const auth = f.auth;
    const m = f.mandate({ cartExpiry: f.now + 100_000n });
    const nonce = await f.settler.read.authNonceFor([m.cartHash, m.payee]);
    const sig = await f.sign({ nonce, validBefore: f.now + 60n });
    await time.increase(120);
    await expect(
      f.settler.write.settle([m, f.payer.account.address, auth(sig)]),
    ).to.be.rejectedWith("authorization is expired");
  });

  it("rejects zero-amount and zero-payee mandates", async () => {
    const f = await loadFixture(fixture);
    const auth = f.auth;
    const nonce = await f.settler.read.authNonceFor([f.cartHash, f.payee.account.address]);
    const sig = await f.sign({ nonce });
    await expect(
      f.settler.write.settle([f.mandate({ amount: 0n }), f.payer.account.address, auth(sig)]),
    ).to.be.rejectedWith("InvalidMandate");
  });
});

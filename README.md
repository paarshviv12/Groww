# GROWW — G for goated

**Get paid in USDC by people and AI agents. One signature. One cart. Nothing can be changed on the way.**

GROWW is a payments API on HashKey Chain. A merchant (or an AI agent selling something) creates a signed **cart**, which is an HSP Cart Mandate, and gets a pay link. A person pays it from a wallet, or an agent pays it from code with the SDK. The payer signs **once**. That signature covers the cart hash, the recipient and the amount, so nobody in the middle can redirect or inflate the payment. One contract settles it, and whether a cart is paid is always read from the chain.

Hackathon: HSK Chain Horizon · India (Mumbai) · Track 2: Agent Payments & A2A Settlement (HSP)

## The product

| Surface | What it is |
| --- | --- |
| `/create` | A merchant enters a wallet address and an amount and gets a pay link. The page shows when it is paid. No account. |
| `/pay/<cart>` | The checkout. Connect a wallet, sign once, pay no gas, see the receipt read from the contract. |
| `/dashboard` | Payments received by an address, read from the contract's events. |
| `/docs` | Integration guide and API reference. |
| `sdk/` | `groww-sdk` and the `groww` CLI. An agent pays a cart from code, with its own spending limit. |
| `POST /api/v1/carts`, `GET /api/v1/carts/:id`, `POST /api/v1/carts/:id/settle`, `POST /api/v1/verify`, `GET /api/v1/payments` | The API. There is no database: a cart is a signed token and its status comes from the chain. |
| `/` | The landing page with a live replay of two agents paying each other and a "try to cheat" demo. |

```bash
# merchant: create a cart
curl -X POST $GROWW/api/v1/carts -H 'content-type: application/json' \
  -d '{"payTo":"0xYOUR_WALLET","amountUsd":"1.50","description":"Logo design"}'

# agent: pay it (key stays on the agent's machine; refuses anything over $5)
GROWW_API=$GROWW GROWW_KEY=0x… npx groww pay "<payUrl>" --max 5

# merchant: is it paid? (answered by the contract)
curl $GROWW/api/v1/carts/<id>
```

## The idea

HSP payments use two mandates: the merchant's **Cart Mandate** and the payer's **Payment Mandate**. The weak spot is the link between them. Nothing on chain ties the payer's signature to one specific cart.

GROWW ties them together with a single EIP-3009 `receiveWithAuthorization` signature whose nonce is

```
nonce = keccak256(abi.encode("GROWW.v1", chainId, settler, cartHash, payee))
```

- `cartHash` = SHA-256 of the canonical JSON of the cart (HSP's rule), so any change to the order changes the hash.
- The token itself checks the signature over `value` and `nonce`. If the payee, amount or cart differs, the signature fails.
- Anyone can relay the transaction, so the payer needs no gas.
- The contract records a receipt per cart hash, so a replay is rejected.

## What is real

| Piece | Status |
| --- | --- |
| `MandateSettler` contract, 9 tests (replay, redirect, inflate, wrong cart, wrong signer, expiry) | Done |
| Cart Mandate: canonical JSON, cart hash, ES256K merchant signature, validation rules from the HSP docs | Done, 8 tests |
| Two agents (merchant and payer) with a spending policy | Done |
| Product API (create cart, status, settle, verify, payments), pay page, create page, dashboard, docs | Done, 8 tests for cart creation and tamper checks |
| `groww-sdk` and CLI: an agent pays a cart with a per-payment limit and a payee allow-list | Done, tested end to end against a chain |
| Settlement on HSK Chain with USDC.e | Done (mainnet deployment: see `chain/deployments/hashkey.json`) |
| "Try to cheat": four tampered mandates dry-run against the contract | Done |
| In-browser checks: cart hash, nonce, on-chain receipt | Done |
| "Pay with my wallet": a person connects a browser wallet, sees a plain-language approval sheet, signs the same mandate, and the merchant relays it | Done (tested with a mock wallet; try it with your real wallet before the video) |
| HSP gateway client (HMAC signing, create order, query, webhook verify) | Written from the docs. Not connected: HSP merchant credentials are issued by hand and we did not receive any in time |

We do not claim the HSP gateway is wired in. The cart format and state names follow HSP; settlement goes straight through our contract.

## Run it

```bash
./setup.sh
cd app && node scripts/make-wallets.mjs     # creates the wallets and cart-signing key, prints addresses only
# fund the agent wallet on HSK Chain: ~0.05 HSK and ~2 USDC.e
npx tsx scripts/preflight.mts               # checks the balances
cd .. && ./mainnet-deploy.sh                # tests, then deploys the contract
./mainnet-serve.sh                          # http://localhost:3000
./mainnet-record.sh                         # in a second terminal: saves one real run for replay
```

Local, no real funds: `cd chain && npx hardhat node`, then `npx hardhat run scripts/deploy.ts --network localhost`, then start the app with `NETWORK=local`.

## Layout

- `chain/` Solidity contract, Hardhat tests, deploy script
- `app/src/lib/hsp/` canonical JSON, cart validation, ES256K signing, gateway client
- `app/src/lib/agents/` merchant agent, payer agent, tamper demo (the landing-page demo)
- `app/src/lib/v1.ts` and `app/src/app/api/v1/` the product API
- `sdk/` the SDK and CLI
- `render-start.sh` starts the site on a host such as Render (a private test chain, or mainnet when `NETWORK=mainnet`)
- `app/src/app/` the interface (a cheque that fills in, a receipt tape, a "check it yourself" panel) and the API routes

## Front end

Next.js 15, React 19, GSAP (ScrollTrigger for the pinned side-scroll, marquees and scroll-driven motion), Anton and Archivo fonts bundled locally, and original SVG artwork. Motion is switched off for visitors who ask for reduced motion.

## Credits

The pebble character is drawn by the [bloub](https://github.com/jeremy-prt/bloub) animation engine by Jérémy Perret (MIT). Only the engine and the "galet" skin are vendored in `app/src/lib/pebble/`, with the original licence in `LICENSE-bloub.txt`.

The settlement contract is named `MandateSettler`. The nonce domain string `GROWW.v1` is part of the signed data, so it must match in the contract and the app.

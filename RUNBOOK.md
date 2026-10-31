# Your steps (Nov 1, deadline 21:30 IST)

1. **Setup (5 min).** Install Node 20+. Unzip. Run `./setup.sh`.
2. **Wallets (1 min).** `cd app && node scripts/make-wallets.mjs`. It prints three addresses: the *Agent wallet* (deploys the contract, pays in the demo), the *Relayer wallet* (pays gas for payments; needs HSK only) and a demo merchant. It also makes the key GROWW signs carts with. All keys stay in `.env.mainnet` on your machine. Never share or commit that file.
3. **Fund on HashKey Chain (chain 177).** Agent wallet: about 0.05 HSK and about 2 USDC.e. Relayer wallet: about 0.05 HSK. The token must be USDC.e at `0x054ed45810DbBAb8B27668922D110669c9D88D0a`. Options for getting funds there: the bridges listed in the HashKey Chain docs (Build on HashKey Chain > Tools > Bridges), the thirdweb bridge, or an exchange that supports HashKey Chain. Send a tiny test amount first.
4. **Check:** `cd app && npx tsx scripts/preflight.mts` should print ok on every line.
5. **Deploy the contract:** from the project root, `./mainnet-deploy.sh`. It runs the tests, then deploys. Keep `chain/deployments/hashkey.json` (it holds the address and the deploy block).
6. **Try it for real on your machine:** `./mainnet-serve.sh`, open http://localhost:3000/create, make a $0.05 link to your own wallet, pay it from a second wallet. Check `/dashboard`.
7. **Record one run for the landing-page replay:** with the server running, `./mainnet-record.sh` in a second terminal.
8. **Public site (Render).** Push to GitHub. New Web Service. Build: `cd chain && npm install && cd ../app && npm install && npm run build`. Start: `bash render-start.sh`. Environment variables (values are in `.env.mainnet` and `chain/deployments/hashkey.json`):
   - `NODE_VERSION=20`
   - `NETWORK=mainnet`
   - `SETTLER_ADDRESS`, `SETTLER_FROM_BLOCK` (the deploy block)
   - `RELAYER_KEY`, `MERCHANT_PRIVATE_KEY_PEM` (the whole one-line value, with its `\n`)
   - `AGENT_KEY`, `MERCHANT_PAY_TO`, `DEMO_KEY` (only the landing-page demo uses these; `DEMO_KEY` stops strangers from spending the agent's USDC)
   - `PUBLIC_URL=https://<your-service>.onrender.com`
9. **On the live site:** make a link at `/create`, pay it with a real wallet, watch `/dashboard`. Do this once before recording.
10. **Video** (about 2 minutes): see `DEMO-SCRIPT.md`.
11. **DoraHacks:** submit before 17:00 to leave a buffer. Link the repo, the live site, the contract address and the video.

The relayer pays a little HSK gas per payment, so keep an eye on its balance. Public calls are rate limited and every payment is dry-run on the chain first, so only valid, signed payments cost gas.

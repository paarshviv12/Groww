# Demo video (about 3 minutes)

Show a real payment end to end, on mainnet, with two people-sized steps and one agent step.

1. **0:00 Problem.** "Agents and shops will get paid in stablecoins. The hard part is knowing nobody changed the order on the way. GROWW fixes that with one signature."
2. **0:15 Merchant.** On `/create`, enter a wallet and $0.10, "Logo design". Click *Create pay link*. "No account. This is a signed cart."
3. **0:40 Customer.** Open the link. Point at the checks: merchant signature valid, your browser recomputed the fingerprint, you pay no gas. Click pay, sign once in the wallet. Show the receipt "read from the chain" and open the transaction on the explorer.
4. **1:20 Merchant sees it.** Back on `/create` the status flipped to Paid. Open `/dashboard` and show the payment, read from the contract's events.
5. **1:45 Agent.** In a terminal: `groww cart ...`, then `groww pay <link> --max 5`. Then run the same pay again: "already paid". Then a $9 cart: "policy refused". "The agent's own limit stopped it."
6. **2:20 Cheat.** On the landing page click *Try to cheat*. "Redirect the money, raise the price, reuse the signature, impersonate the payer. The contract refuses all four."
7. **2:45 Honesty.** "Carts follow the HSP Cart Mandate format. The HSP gateway rail needs merchant credentials we did not get in time, so settlement goes through our contract on HashKey Chain." End on the contract address and the docs page.

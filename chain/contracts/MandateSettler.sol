// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal view of an EIP-3009 token (Circle FiatToken / HashKey USDC.e).
interface IEIP3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
}

/// @title MandateSettler
/// @notice Settles an agent-to-agent payment only if the payer's single wallet signature
///         authorises exactly this cart. The signature is a standard EIP-3009
///         `receiveWithAuthorization` whose `nonce` is derived from the HSP Cart Mandate
///         hash and the payee. Change the cart, the payee or the amount and the token
///         rejects the signature, so a mandate cannot be redirected, inflated or replayed.
///         Anyone may submit the settlement (the payer pays no gas).
contract MandateSettler {
    struct Mandate {
        bytes32 cartHash; // SHA-256 of the canonical JSON of cart_mandate.contents (HSP / RFC 8785)
        address token; // EIP-3009 token, e.g. USDC.e on HashKey Chain
        address payee; // cart pay_to
        uint256 amount; // token base units
        uint64 cartExpiry; // cart_expiry as unix seconds
    }

    /// @dev The payer's EIP-3009 authorization window and signature.
    struct Authorization {
        uint256 validAfter;
        uint256 validBefore;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct Receipt {
        address payer;
        address payee;
        address token;
        uint256 amount;
        uint64 settledAt;
        bytes32 authNonce;
    }

    mapping(bytes32 cartHash => Receipt) public receipts;

    event MandateSettled(
        bytes32 indexed cartHash,
        address indexed payer,
        address indexed payee,
        address token,
        uint256 amount,
        bytes32 authNonce
    );

    error CartExpired();
    error AlreadySettled();
    error InvalidMandate();
    error TokenTransferFailed();
    error UnexpectedReceived();

    /// @notice The EIP-3009 nonce the payer must sign for this cart + payee on this deployment.
    function authNonceFor(bytes32 cartHash, address payee) public view returns (bytes32) {
        return keccak256(abi.encode("GROWW.v1", block.chainid, address(this), cartHash, payee));
    }

    function isSettled(bytes32 cartHash) external view returns (bool) {
        return receipts[cartHash].settledAt != 0;
    }

    function settle(
        Mandate calldata m,
        address payer,
        Authorization calldata a
    ) external {
        if (m.amount == 0 || m.payee == address(0) || m.token == address(0) || payer == address(0)) {
            revert InvalidMandate();
        }
        if (block.timestamp > m.cartExpiry) revert CartExpired();
        if (receipts[m.cartHash].settledAt != 0) revert AlreadySettled();

        bytes32 nonce = authNonceFor(m.cartHash, m.payee);

        receipts[m.cartHash] = Receipt({
            payer: payer,
            payee: m.payee,
            token: m.token,
            amount: m.amount,
            settledAt: uint64(block.timestamp),
            authNonce: nonce
        });

        IEIP3009 token = IEIP3009(m.token);
        uint256 balBefore = token.balanceOf(address(this));
        // Reverts inside the token unless `payer` signed exactly (this contract, amount, nonce).
        token.receiveWithAuthorization(payer, address(this), m.amount, a.validAfter, a.validBefore, nonce, a.v, a.r, a.s);
        if (token.balanceOf(address(this)) - balBefore != m.amount) revert UnexpectedReceived();

        (bool ok, bytes memory ret) = m.token.call(abi.encodeCall(IEIP3009.transfer, (m.payee, m.amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TokenTransferFailed();

        emit MandateSettled(m.cartHash, payer, m.payee, m.token, m.amount, nonce);
    }
}

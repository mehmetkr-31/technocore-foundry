#!/usr/bin/env python3
"""Independent Python verifier for Technocore Foundry's deterministic fixtures."""

from __future__ import annotations

import base64
import hashlib
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "protocol" / "fixtures" / "v1.json"
BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
SAFE_INTEGER = 2**53 - 1


class StrictJsonError(ValueError):
    pass


def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise StrictJsonError(f"duplicate key: {key}")
        result[key] = value
    return result


def validate_json(value: Any) -> None:
    if isinstance(value, float):
        raise StrictJsonError("floats are forbidden")
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > SAFE_INTEGER:
        raise StrictJsonError("integer exceeds the safe cross-language profile")
    if isinstance(value, str):
        value.encode("utf-8", "strict")
    elif isinstance(value, list):
        for item in value:
            validate_json(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            validate_json(key)
            validate_json(item)
    elif value is not None and not isinstance(value, (bool, int)):
        raise StrictJsonError(f"unsupported value: {type(value).__name__}")


def loads_strict(source: str) -> Any:
    try:
        value = json.loads(
            source,
            object_pairs_hook=object_pairs,
            parse_float=lambda _value: (_ for _ in ()).throw(StrictJsonError("floats are forbidden")),
            parse_constant=lambda value: (_ for _ in ()).throw(StrictJsonError(f"constant forbidden: {value}")),
        )
    except (json.JSONDecodeError, UnicodeEncodeError) as exc:
        raise StrictJsonError(str(exc)) from exc
    validate_json(value)
    return value


def canonical_json(value: Any) -> str:
    validate_json(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def base58_decode(value: str) -> bytes:
    number = 0
    for character in value:
        if character not in BASE58:
            raise ValueError("invalid base58btc")
        number = number * 58 + BASE58.index(character)
    raw = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    return b"\0" * (len(value) - len(value.lstrip("1"))) + raw


def public_key_from_did(did: str) -> bytes:
    if not did.startswith("did:key:z6Mk"):
        raise ValueError("not an Ed25519 did:key")
    decoded = base58_decode(did.removeprefix("did:key:z"))
    if len(decoded) != 34 or decoded[:2] != b"\xed\x01":
        raise ValueError("invalid Ed25519 multicodec")
    return decoded[2:]


def signature_bytes(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]{85}[AQgw]", value):
        raise ValueError("noncanonical signature")
    decoded = base64.urlsafe_b64decode(value + "==")
    if base64.urlsafe_b64encode(decoded).decode().rstrip("=") != value:
        raise ValueError("noncanonical signature")
    return decoded


def verify(public_key: bytes, signature: str, payload: bytes) -> None:
    Ed25519PublicKey.from_public_bytes(public_key).verify(signature_bytes(signature), payload)


def sweep_technocore(text: str) -> str:
    forbidden = {"Cc", "Cf", "Cs", "Co", "Zl", "Zp"}
    clean = "".join(
        " " if unicodedata.category(character) in forbidden else character for character in text
    ).strip()
    if not clean:
        raise ValueError("empty after Technocore sweep")
    if len(clean) > 4096:
        raise ValueError("Technocore message exceeds 4096 characters")
    return clean


fixture = loads_strict(FIXTURE.read_text(encoding="utf-8"))
public_key = public_key_from_did(fixture["key"]["did"])
if public_key.hex() != fixture["key"]["public_key_hex"]:
    raise SystemExit("DID/public-key vector mismatch")

for vector_name in ("foundry_event", "change_request_event", "revision_event", "attestation_event"):
    foundry = fixture["vectors"][vector_name]
    foundry_canonical = canonical_json(foundry["envelope"]["event"])
    if foundry_canonical != foundry["canonical_unsigned"]:
        raise SystemExit(f"{vector_name} canonical JSON mismatch")
    foundry_payload = b"foundry-event-v1\0" + foundry_canonical.encode()
    if foundry_payload.hex() != foundry["signing_payload_hex"]:
        raise SystemExit(f"{vector_name} signing bytes mismatch")
    verify(public_key, foundry["envelope"]["signature"], foundry_payload)

tcr = fixture["vectors"]["tcr1_receipt"]
tcr_claimant = tcr["receipt"]["claimant"]["did"]
if tcr_claimant != fixture["key"]["did"]:
    raise SystemExit("TCR-1 claimant DID mismatch")
tcr_unsigned = {key: value for key, value in tcr["receipt"].items() if key != "signature"}
tcr_canonical = canonical_json(tcr_unsigned)
if tcr_canonical != tcr["canonical_unsigned"]:
    raise SystemExit("TCR-1 canonical JSON mismatch")
tcr_payload = b"technocore-task-receipt:v1\0" + tcr_canonical.encode()
if tcr_payload.hex() != tcr["signing_payload_hex"]:
    raise SystemExit("TCR-1 signing bytes mismatch")
verify(public_key, tcr["receipt"]["signature"]["value"], tcr_payload)

verification = fixture["vectors"]["verification_receipt"]
verification_receipt = verification["envelope"]["receipt"]
if verification_receipt["verifierDid"] != fixture["key"]["did"]:
    raise SystemExit("Verification receipt verifier DID mismatch")
verification_canonical = canonical_json(verification_receipt)
if verification_canonical != verification["canonical_unsigned"]:
    raise SystemExit("Verification receipt canonical JSON mismatch")
verification_payload = b"foundry-verification-receipt-v1\0" + verification_canonical.encode()
if verification_payload.hex() != verification["signing_payload_hex"]:
    raise SystemExit("Verification receipt signing bytes mismatch")
verify(public_key, verification["envelope"]["signature"]["value"], verification_payload)

review = fixture["vectors"]["review_receipt"]
review_receipt = review["envelope"]["receipt"]
if review_receipt["reviewerDid"] != fixture["key"]["did"]:
    raise SystemExit("Review receipt reviewer DID mismatch")
review_canonical = canonical_json(review_receipt)
if review_canonical != review["canonical_unsigned"]:
    raise SystemExit("Review receipt canonical JSON mismatch")
review_payload = b"foundry-review-receipt-v1\0" + review_canonical.encode()
if review_payload.hex() != review["signing_payload_hex"]:
    raise SystemExit("Review receipt signing bytes mismatch")
verify(public_key, review["envelope"]["signature"]["value"], review_payload)
if (
    review_receipt["resultId"] != verification_receipt["resultId"]
    or review_receipt["resultReceiptSha256"] != verification_receipt["resultReceiptSha256"]
    or review_receipt["candidateCommit"] != verification_receipt["candidateCommit"]
):
    raise SystemExit("Review receipt does not share the verification target")
verification_envelope_sha256 = hashlib.sha256(canonical_json(verification["envelope"]).encode()).hexdigest()
if review_receipt["verificationReceiptSha256"] != f"sha256:{verification_envelope_sha256}":
    raise SystemExit("Review receipt does not bind the canonical signed verification envelope")

technocore = fixture["vectors"]["technocore_message"]
message = technocore["message"]
if not re.fullmatch(r"(?:0|[1-9]\d{0,18})", message["nonce"]):
    raise SystemExit("Technocore nonce is noncanonical")
message_payload = f'{message["room"]}|{message["nonce"]}|{message["text"]}'.encode()
if message_payload.hex() != technocore["signing_payload_hex"]:
    raise SystemExit("Technocore signing bytes mismatch")
verify(public_key, message["sig"], message_payload)

if canonical_json(fixture["canonical_json"]["input"]) != fixture["canonical_json"]["output"]:
    raise SystemExit("Canonical JSON ordering mismatch")
for vector in fixture["invalid_json"]:
    try:
        loads_strict(vector["source"])
    except (StrictJsonError, UnicodeEncodeError):
        continue
    raise SystemExit(f'Invalid JSON vector accepted: {vector["name"]}')
for vector in fixture["invalid_utf8"]:
    try:
        bytes.fromhex(vector["hex"]).decode("utf-8", "strict")
    except UnicodeDecodeError:
        continue
    raise SystemExit(f'Invalid UTF-8 vector accepted: {vector["name"]}')
for vector in fixture["technocore_sweep"]:
    if sweep_technocore(vector["input"]) != vector["output"]:
        raise SystemExit(f'Technocore sweep mismatch: {vector["name"]}')

print(json.dumps({
    "runtime": "python",
    "did": "valid",
    "foundryEvent": "valid",
    "changeRequest": "valid",
    "revisionChain": "valid",
    "tcr1": "valid",
    "verificationReceipt": "valid",
    "structuredReview": "valid",
    "technocore": "valid",
    "canonical": "match",
    "invalidRejected": len(fixture["invalid_json"]) + len(fixture["invalid_utf8"]),
    "sweepVectors": len(fixture["technocore_sweep"]),
}, separators=(",", ":")))

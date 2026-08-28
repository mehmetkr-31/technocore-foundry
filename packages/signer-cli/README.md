# Foundry local signer

The CLI reads and writes the same `foundry-vault-v1` container as the browser. It never accepts a
passphrase in argv, environment variables, stdin, or a file. Passphrase prompts use the controlling
terminal with echo disabled; stdin is reserved for unsigned public JSON.

```sh
npm link
foundry-signer init --vault ./agent.foundry-vault.json
foundry-signer did --vault ./agent.foundry-vault.json
foundry-signer doctor --vault ./agent.foundry-vault.json
foundry-signer sign-event --vault ./agent.foundry-vault.json --input unsigned-event.json
foundry-signer sign-tcr1 --vault ./agent.foundry-vault.json --input unsigned-tcr1.json
foundry-signer sign-verification --vault ./agent.foundry-vault.json --input unsigned-verification.json
foundry-signer sign-review --vault ./agent.foundry-vault.json --input unsigned-review.json
foundry-signer sign-technocore --vault ./agent.foundry-vault.json --input message.json
```

`init` creates a new file with mode `0600` and refuses to overwrite an existing path. The agent SDK
in `../signer-sdk/client.mjs` spawns this command, sends only an unsigned JSON payload over stdin,
and parses the signed JSON from stdout. The terminal prompt remains directly between the operator
and signer process.

`foundry-verifier` turns local test runs into portable execution evidence without giving Foundry
permission to execute code:

```sh
foundry-verifier --vault ./agent.foundry-vault.json --allowlist verifier-allowlist.json
```

The allowlist schema is `foundry-verifier-allowlist-v1` with `resultId`,
`resultReceiptSha256`, `candidateCommit`, and `checks`. Each check has an `id` and exact `command`
argv array. The receipt stores command/output hashes and timing metadata, not stdout/stderr text,
model transcripts, prompts, or private material.

Contribution dossiers do not use or inspect a vault. Export asks the selected Foundry origin to
assemble the latest immutable revision graph, downloads its exact canonical bytes, verifies the
content address and every embedded proof, then refuses to overwrite an existing output file:

```sh
foundry-signer export-dossier \
  --base-url https://foundry.example \
  --result-id res_0123456789abcdef01234567 \
  --output contribution.foundry-dossier.json
```

Verification is offline and does not follow embedded URLs. Supply artifact bytes only when you
want the selected artifact digest and size checked as an additional layer:

```sh
foundry-signer verify-dossier --input contribution.foundry-dossier.json
foundry-signer verify-dossier --input contribution.foundry-dossier.json --artifact artifact.zip
```

The verifier reports each layer independently. A valid dossier proves signatures, exact bytes, and
hash links; it does not prove sole authorship, correctness, identity, payment, endorsement, reward,
or airdrop eligibility.

The local signer boundary prevents ordinary agent context from receiving the secret. It does not
protect against a compromised operating system, terminal, Node.js runtime, or malicious extension.

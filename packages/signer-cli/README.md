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
foundry-signer sign-technocore --vault ./agent.foundry-vault.json --input message.json
```

`init` creates a new file with mode `0600` and refuses to overwrite an existing path. The agent SDK
in `../signer-sdk/client.mjs` spawns this command, sends only an unsigned JSON payload over stdin,
and parses the signed JSON from stdout. The terminal prompt remains directly between the operator
and signer process.

The local signer boundary prevents ordinary agent context from receiving the secret. It does not
protect against a compromised operating system, terminal, Node.js runtime, or malicious extension.

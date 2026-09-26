# Social token encryption key rotation

Forge encrypts Instagram access tokens and staged OAuth results with
AES-256-GCM. `SOCIAL_TOKEN_ENCRYPTION_KEY` is always the active encryption key.
`SOCIAL_TOKEN_PREVIOUS_KEYS` is an optional comma-separated list of up to three
distinct older base64url 32-byte keys. The worker and OAuth callback can
decrypt with the active key or one of those previous keys. New and refreshed
credentials are encrypted with the active key.

Use this sequence in each environment:

1. Generate a new random 32-byte key in the environment's secret manager.
   Keep the existing key. Never put either key in a command line, log, ticket or
   repository.
2. Distribute a configuration that lets every web and worker instance decrypt
   both keys before changing the active key. During a rolling deployment,
   instances still using the old active key can list the new key as a previous
   key; new instances use the new active key and list the old key as previous.
3. After every instance accepts both keys, set the new key as
   `SOCIAL_TOKEN_ENCRYPTION_KEY` everywhere and keep the old one in
   `SOCIAL_TOKEN_PREVIOUS_KEYS`.
4. In a trusted operator environment with the new active key and old previous
   key configured, run `npm run social:token:rotate -- dry-run`, then
   `npm run social:token:rotate -- apply`. The command scans account credentials
   and live staged OAuth results, rewraps only ciphertext that uses a previous
   key, and writes one audit event per successful rewrap. It prints counts and
   record IDs on error, never plaintext or keys.
5. Run `dry-run` again. If its `due` counts are nonzero, investigate or repeat
   `apply`. Allow in-flight OAuth attempts to finish or expire (up to ten
   minutes), then run `dry-run` once more. Remove the old key only after all
   instances use the new active key and no live ciphertext needs the old one.

The command uses compare-and-swap database updates, so concurrent token
refreshes or OAuth completions cannot be overwritten. A dry run that cannot
decrypt a record fails instead of skipping it. The ciphertext format does not
contain a key identifier; decryption tries only the configured bounded key
ring. No live key rotation was performed in this workspace.

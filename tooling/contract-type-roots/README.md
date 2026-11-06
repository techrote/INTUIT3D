# Isolated TypeScript declaration test roots

This intentionally contains no ambient type package. Integration's SKETCH
consumer compile uses this root rather than auto-importing unrelated global
`@types/*` from the optional web UI dependencies. Strict declaration checking
remains active; never use `skipLibCheck` to mask errors in the published contract.

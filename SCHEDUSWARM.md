# SCHEDUSWARM.md — intentional non-activation

```yaml
scheduswarm_version: 2
status: disabled
hub: https://github.com/techrote/scheduswarm
queue_branch: scheduswarm/queue
max_active_lanes: 5
project_concurrency_budget: 3
successors_per_lane: 1
integration_writes_parallel: false
automatic_dispatch_allowed: false
```

**INTUIT3D does not use scheduswarm's dispatcher.** The owner selected five **permanent, fixed hourly scheduled workers** instead of a central dispatcher or worker-published successor queue. The Scheduswarm v2 dispatcher must not dispatch work for INTUIT3D. Workers must not create task envelopes or successor scheduled tasks.

We borrow repository authority, lane admission, immutable evidence, single-writer integration and explicit recovery from https://github.com/techrote/scheduswarm. This file is not authorization to spawn a parallel system or change user scheduling. Activation requires an explicit new owner decision and reconciliation of existing fixed workers.

Project authority is AGENTS.md, docs/ORCHESTRATION.md, docs/ACCEPTANCE.md, living issues/PRs and accepted main; docs/STATUS.md is an index, not a lock.

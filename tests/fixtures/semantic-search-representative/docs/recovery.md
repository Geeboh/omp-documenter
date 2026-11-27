# Failure recovery

Failure recovery starts from the last checkpoint. Replay events in order, record the
failure, and apply compensation before resuming an interrupted operation.

The recovery runbook documents safe resume steps and the evidence needed after a
partial outage.

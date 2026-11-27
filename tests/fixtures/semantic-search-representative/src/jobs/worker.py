class QueueWorker:
    def __init__(self, queue, lease_seconds=60, heartbeat_interval=15):
        self.queue = queue
        self.lease_seconds = lease_seconds
        self.heartbeat_interval = heartbeat_interval

    def run_once(self):
        job = self.queue.claim(lease_seconds=self.lease_seconds)
        if job is None:
            return False
        try:
            self.queue.heartbeat(job.id, interval=self.heartbeat_interval)
            job.handle()
            self.queue.ack(job.id)
        except Exception as error:
            self.queue.dead_letter(job.id, reason=str(error))
        return True

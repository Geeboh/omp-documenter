class RecoveryReconciler:
    def __init__(self, store, handlers):
        self.store = store
        self.handlers = handlers

    def reconcile(self, operation_id):
        checkpoint = self.store.load_checkpoint(operation_id)
        for event in self.store.events_after(checkpoint.sequence):
            self.handlers[event.kind].apply(event)
            self.store.save_checkpoint(operation_id, event.sequence)
        return self.store.status(operation_id)

    def compensate(self, operation_id, failure):
        self.store.record_failure(operation_id, str(failure))
        self.handlers['compensation'].apply(operation_id)
        return self.store.status(operation_id)

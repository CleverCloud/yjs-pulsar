export class CleanupManager {
    private pendingCleanupPromises: Set<Promise<any>> = new Set();

    add(promise: Promise<any>) {
        this.pendingCleanupPromises.add(promise);
        promise.finally(() => {
            this.pendingCleanupPromises.delete(promise);
        });
    }

    async waitForAll() {
        await Promise.allSettled(Array.from(this.pendingCleanupPromises));
    }

    get pendingCount(): number {
        return this.pendingCleanupPromises.size;
    }
}

export const cleanupManager = new CleanupManager();

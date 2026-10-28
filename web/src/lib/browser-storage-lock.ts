type AsyncBrowserLock = {
    request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

type LocalStorageLockRecord = {
    owner: string;
    ticket: number;
    choosing: boolean;
    expiresAt: number;
};

type LocalStorageParticipant = {
    key: string;
    record: LocalStorageLockRecord;
};

export type BrowserStorageLockOptions = {
    requireCrossTabLock?: boolean;
    unavailableMessage: string;
};

const LOCAL_STORAGE_LOCK_PREFIX = "yingce:cross-tab-storage-lock:v1:";
const LOCAL_STORAGE_LEASE_MS = 180_000;
const LOCAL_STORAGE_HEARTBEAT_MS = 20_000;
const LOCAL_STORAGE_RETRY_MS = 25;
let ownerSequence = 0;

function browserPageAvailable() {
    return typeof window !== "undefined" && typeof document !== "undefined";
}

function browserWebLocks(): AsyncBrowserLock | undefined {
    if (typeof navigator === "undefined") return undefined;
    const locks = navigator.locks as AsyncBrowserLock | undefined;
    return typeof locks?.request === "function" ? locks : undefined;
}

function localStorageForLock(): Storage | undefined {
    if (!browserPageAvailable()) return undefined;
    try {
        const storage = window.localStorage;
        const probeKey = `${LOCAL_STORAGE_LOCK_PREFIX}probe:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
        storage.setItem(probeKey, "1");
        const available = storage.getItem(probeKey) === "1";
        storage.removeItem(probeKey);
        return available ? storage : undefined;
    } catch {
        return undefined;
    }
}

function createOwner() {
    ownerSequence += 1;
    return `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}:${ownerSequence}`;
}

function lockKey(name: string, owner: string) {
    return `${LOCAL_STORAGE_LOCK_PREFIX}${encodeURIComponent(name)}:${owner}`;
}

function lockKeyPrefix(name: string) {
    return `${LOCAL_STORAGE_LOCK_PREFIX}${encodeURIComponent(name)}:`;
}

function parseLockRecord(value: string | null): LocalStorageLockRecord | undefined {
    if (!value) return undefined;
    try {
        const record = JSON.parse(value) as Partial<LocalStorageLockRecord>;
        const { owner, ticket, choosing, expiresAt } = record;
        if (
            typeof owner !== "string" ||
            typeof ticket !== "number" ||
            !Number.isSafeInteger(ticket) ||
            ticket < 0 ||
            typeof choosing !== "boolean" ||
            typeof expiresAt !== "number" ||
            !Number.isFinite(expiresAt)
        ) {
            return undefined;
        }
        return { owner, ticket, choosing, expiresAt };
    } catch {
        return undefined;
    }
}

function writeLockRecord(storage: Storage, key: string, record: LocalStorageLockRecord) {
    storage.setItem(key, JSON.stringify(record));
}

function readParticipants(storage: Storage, prefix: string, now: number): LocalStorageParticipant[] {
    const participants: LocalStorageParticipant[] = [];
    for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (!key || !key.startsWith(prefix)) continue;
        const record = parseLockRecord(storage.getItem(key));
        if (!record || record.expiresAt <= now) {
            storage.removeItem(key);
            continue;
        }
        participants.push({ key, record });
    }
    return participants;
}

function waitForLocalStorageLockRetry() {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, LOCAL_STORAGE_RETRY_MS);
    });
}

function hasPriority(left: LocalStorageLockRecord, right: LocalStorageLockRecord) {
    return left.ticket < right.ticket || (left.ticket === right.ticket && left.owner < right.owner);
}

function requestLocalStorageLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const storage = localStorageForLock();
    if (!storage) throw new Error("localStorage unavailable");
    return acquireLocalStorageLock(storage, name, operation);
}

async function acquireLocalStorageLock<T>(storage: Storage, name: string, operation: () => Promise<T>): Promise<T> {
    const owner = createOwner();
    const key = lockKey(name, owner);
    const prefix = lockKeyPrefix(name);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let heartbeatFailure: Error | undefined;

    try {
        writeLockRecord(storage, key, {
            owner,
            ticket: 0,
            choosing: true,
            expiresAt: Date.now() + LOCAL_STORAGE_LEASE_MS,
        });
        const ticket = readParticipants(storage, prefix, Date.now()).reduce((highest, participant) => Math.max(highest, participant.record.ticket), 0) + 1;
        const record: LocalStorageLockRecord = {
            owner,
            ticket,
            choosing: false,
            expiresAt: Date.now() + LOCAL_STORAGE_LEASE_MS,
        };
        writeLockRecord(storage, key, record);

        while (true) {
            const own = parseLockRecord(storage.getItem(key));
            if (!own || own.owner !== owner || own.ticket !== ticket || own.choosing) {
                throw new Error("跨标签存储锁状态丢失");
            }
            const blocked = readParticipants(storage, prefix, Date.now()).some((participant) => participant.key !== key && (participant.record.choosing || hasPriority(participant.record, own)));
            if (!blocked) break;
            await waitForLocalStorageLockRetry();
        }

        heartbeat = setInterval(() => {
            try {
                const current = parseLockRecord(storage.getItem(key));
                if (!current || current.owner !== owner || current.ticket !== ticket || current.choosing) {
                    heartbeatFailure = new Error("跨标签存储锁租约已失效");
                    return;
                }
                writeLockRecord(storage, key, { ...current, expiresAt: Date.now() + LOCAL_STORAGE_LEASE_MS });
            } catch {
                heartbeatFailure = new Error("跨标签存储锁续约失败");
            }
        }, LOCAL_STORAGE_HEARTBEAT_MS);

        const result = await operation();
        if (heartbeatFailure) throw heartbeatFailure;
        return result;
    } finally {
        if (heartbeat) clearInterval(heartbeat);
        try {
            const current = parseLockRecord(storage.getItem(key));
            if (current?.owner === owner) storage.removeItem(key);
        } catch {
            // A failed cleanup must not hide the operation result; the lease bounds stale ownership.
        }
    }
}

/**
 * Locks browser storage across tabs. Web Locks is authoritative when available;
 * older browsers coordinate through short-lived per-contender localStorage records.
 */
export function withBrowserStorageLock<T>(name: string, operation: () => Promise<T>, options: BrowserStorageLockOptions): Promise<T> {
    const locks = browserWebLocks();
    if (locks) return locks.request(name, operation);
    if (!browserPageAvailable()) return operation();
    try {
        return requestLocalStorageLock(name, operation);
    } catch (error) {
        if (options.requireCrossTabLock && error instanceof Error && error.message === "localStorage unavailable") {
            return Promise.reject(new Error(options.unavailableMessage));
        }
        if (!options.requireCrossTabLock && error instanceof Error && error.message === "localStorage unavailable") return operation();
        return Promise.reject(error);
    }
}

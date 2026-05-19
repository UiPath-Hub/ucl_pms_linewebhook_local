import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase, Reference, DataSnapshot } from "firebase-admin/database";

const serviceAccount: any = require('./../ucl-pms-project-firebase-c6b10789f613.json');

import {
    EventTransactionInfo,
} from './type';

/**
 * =========================================================
 * Result outcome / user story
 * =========================================================
 * Single server instance + single active worker transaction pipeline
 *
 * Firebase responsibilities:
 * - Event source
 * - Transaction journal
 * - Monitoring / reporting
 * - Recovery persistence
 *
 * Local memory responsibilities:
 * - Concurrency control
 * - Pending queue
 * - Deduplication
 * - Worker execution state
 *
 * Important:
 * - No distributed lock
 * - No distributed queue
 * - No multi-state listeners
 * - No Firebase transaction orchestration
 */

/**
 * =========================================================
 * I/O
 * =========================================================
 */

const databaseURL = { value: () => process.env.DATABASE_URL! };
const storageBucket = { value: () => process.env.STORAGEBUCKET_URL! };

const app = initializeApp({
    credential: cert(serviceAccount),
    storageBucket: storageBucket.value(),
    databaseURL: databaseURL.value()
});

const database = getDatabase(app);

const ServerInstanceDatabase = database.ref("/" + (process.env.SERVER_INSTANCE_DATABASE || "defaultInstanceName"));

/**
 * =========================================================
 * Core definitions
 * =========================================================
 */

const transactionState = {
    new: "new",
    process: "process",
    failed: "failed",
    successful: "successful",
    pending: "pending",
    pending_authentication:"pending_authentication",
    finalize: "finalize",
    takeover: "takeover"
} as const;

type TransactionState =
    | "new"
    | "process"
    | "failed"
    | "successful"
    | "pending"
    | "finalize"
    | "takeover";

type ProcessState = "processing" | "complete";

type uipathToken = {
    access_token: string,
    expires_in: number,
    expired_time: string,
    scope: string,
    token_type: string,
    folderInfo?: any,
    requireToken?: true
};

type performerCache = {
    runningTrace: number,
    maxTrace: number,
    auth?: uipathToken | null
};

const EntryTransactionState = {
    valid: "valid",
    invalid: "invalid"
} as const;

/**
 * =========================================================
 * Local runtime memory
 * =========================================================
 */

let LocalCache: performerCache | null = null;

const PendingQueue: Array<{
    key: string,
    ref: Reference
    snapshot: EventTransactionInfo
}> = [];

/**
 * =========================================================
 * Deduplication
 * =========================================================
 */

const processedTransactions = new Map<
    string,
    {
        timestamp: number,
        state: ProcessState
    }
>();

const DEDUP_WINDOW_MS = 60000;

/**
 * =========================================================
 * Utility
 * =========================================================
 */

const sleep = async (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

const getDeduplicationKey = (
    eventID: string,
    timeStamp: number
): string => {
    return `${eventID}_${timeStamp}`;
};

const isTransactionProcessing = (
    eventID: string,
    timeStamp: number
): boolean => {

    const key = getDeduplicationKey(eventID, timeStamp);

    const stored = processedTransactions.get(key);

    if (!stored) return false;

    /**
     * already completed
     */
    if (stored.state === "complete") {
        return true;
    }

    /**
     * processing timeout
     */
    const age = Date.now() - stored.timestamp;

    if (age > DEDUP_WINDOW_MS) {
        processedTransactions.delete(key);
        return false;
    }

    return true;
};

const markTransactionProcessing = (
    eventID: string,
    timeStamp: number
) => {

    const key = getDeduplicationKey(eventID, timeStamp);

    processedTransactions.set(key, {
        timestamp: Date.now(),
        state: "processing"
    });

    cleanupProcessedTransactions();
};

const markTransactionComplete = (
    eventID: string,
    timeStamp: number
) => {

    const key = getDeduplicationKey(eventID, timeStamp);

    processedTransactions.set(key, {
        timestamp: Date.now(),
        state: "complete"
    });

    cleanupProcessedTransactions();
};

const clearTransactionProcessing = (
    eventID: string,
    timeStamp: number
) => {

    const key = getDeduplicationKey(eventID, timeStamp);

    processedTransactions.delete(key);
};

const cleanupProcessedTransactions = () => {

    if (processedTransactions.size < 10000) return;

    const oldestEntry = Array
        .from(processedTransactions.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];

    if (oldestEntry) {
        processedTransactions.delete(oldestEntry[0]);
    }
};

const getRetryDelay = (retryCount: number): number => {

    const baseDelay = 1000;

    const delay = baseDelay * Math.pow(2, retryCount);

    return Math.min(delay, 60000);
};

const updateTransactionState = (
    ref: Reference,
    key: string,
    newState: TransactionState,
    updateFields?: (transaction: any) => void
): Promise<void> => {

    return new Promise(async (resolve, reject) => {

        try {

            const snapshot = await ref.child(key).get();

            if (!snapshot.exists()) {
                resolve();
                return;
            }

            const current = snapshot.val();

            const updated = {
                ...current,
                state: newState
            };

            if (updateFields) {
                updateFields(updated);
            }

            await ref.child(key).set(updated);

            resolve();

        } catch (err) {
            reject(err);
        }
    });
};

/**
 * =========================================================
 * Pending queue
 * =========================================================
 */

const enqueuePendingTransaction = async (
    ref: Reference,
    key: string,
    snapshot: EventTransactionInfo
) => {

    PendingQueue.push({
        key,
        ref,
        snapshot
    });

    await updateTransactionState(
        ref,
        key,
        transactionState.pending,
        (current) => {
            current.pendingAt = Date.now();
        }
    );

    console.log(`Pending queued: ${key}`);
};

const drainPendingQueue = async (
    defaultCache: performerCache,
    processPipeline: (
        ref: Reference,
        key: string,
        snapshot: EventTransactionInfo
    ) => Promise<void>
) => {

    if (!LocalCache) {
        LocalCache = defaultCache;
    }

    while (
        PendingQueue.length > 0 &&
        LocalCache.runningTrace < LocalCache.maxTrace
    ) {

        const next = PendingQueue.shift();

        if (!next) return;

        await processPipeline(next.ref, next.key, next.snapshot);
    }
};

/**
 * =========================================================
 * Transaction pipeline
 * =========================================================
 */

const processTransactionPipeline = async (
    ref: Reference,
    key: string,
    snapshot: EventTransactionInfo,
    defaultCache: performerCache,

    initializeFunction?: (
        snapshot_queueKey: string,
        snapshot_queueData: EventTransactionInfo
    ) => Promise<"valid" | "invalid">,

    processFunction?: (
        snapshot_queueKey: string,
        snapshot_queueData: EventTransactionInfo
    ) => Promise<any | void>,

    finalizeFunction?: (
        snapshot_queueKey: string,
        snapshot_queueData: EventTransactionInfo
    ) => Promise<any | void>
) => {

    try {

        console.log(`New : ${key} ${snapshot?.timeStamp}`);

        /**
         * dedup
         */
        if (
            isTransactionProcessing(
                snapshot.eventID,
                snapshot.timeStamp
            )
        ) {

            console.log(
                `Duplicate transaction detected: ${snapshot.eventID}`
            );

            return;
        }

        /**
         * initialize local cache
         */
        if (!LocalCache) {
            LocalCache = defaultCache;
        }

        /**
         * initialize validation
         */
        let initializeResult: "valid" | "invalid" =
            EntryTransactionState.valid;

        if (initializeFunction) {

            initializeResult = await initializeFunction(
                key,
                snapshot
            );
        }

        /**
         * invalid initialization
         */
        if (initializeResult === EntryTransactionState.invalid) {

            await updateTransactionState(
                ref,
                key,
                transactionState.failed,
                (current) => {
                    current.output = "failed by invalid initialization";
                }
            );

            return;
        }

        /**
         * capacity check
         */
        if (LocalCache.runningTrace >= LocalCache.maxTrace) {

            await enqueuePendingTransaction(ref, key,snapshot);

            return;
        }

        /**
         * acquire slot
         */
        LocalCache.runningTrace++;

        /**
         * mark processing
         */
        markTransactionProcessing(
            snapshot.eventID,
            snapshot.timeStamp
        );

        await updateTransactionState(
            ref,
            key,
            transactionState.process,
            (current) => {
                current.processedAt = Date.now();

                if (!current.version) {
                    current.version = 0;
                }
            }
        );

        console.log(
            `Transaction accepted for processing: ${snapshot.eventID}`
        );

        /**
         * process
         */
        let output: any = undefined;

        try {

            if (processFunction) {

                output = await processFunction(
                    key,
                    snapshot
                );
            }

        } catch (processErr: any) {

            await updateTransactionState(
                ref,
                key,
                transactionState.failed,
                (current) => {
                    current.output = processErr?.message || processErr;
                    current.failedAt = Date.now();
                }
            );

            throw processErr;
        }

        /**
         * finalize state
         */
        console.log("Finalizing transaction");        
        await updateTransactionState(ref,key,transactionState.finalize,
            (current) => {
                current.finalizeAt = Date.now();
                if (output !== undefined) {
                    current.output = output;
                }
            }
        );

        /**
         * finalize function
         */
  
        try {

            if (finalizeFunction) {

                await finalizeFunction(
                    key,
                    snapshot
                );
            }

            /**
             * successful
             */
            await updateTransactionState(
                ref,
                key,
                transactionState.successful,
                (current) => {
                    current.completedAt = Date.now();
                }
            );

            markTransactionComplete(
                snapshot.eventID,
                snapshot.timeStamp
            );

        } catch (finalizeErr: any) {

            await updateTransactionState(
                ref,
                key,
                transactionState.takeover,
                (current) => {
                    current.output =
                        finalizeErr?.message || finalizeErr;
                }
            );

            throw finalizeErr;
        }

    } catch (err: any) {

        console.log(
            `Pipeline failed: ${key}`,
            err?.message || err
        );

        /**
         * retry
         */
        try {

            if (!snapshot) return;

            const retriesCount =
                snapshot.retriesCount || 0;

            if (retriesCount < 3) {

                const delayMs = getRetryDelay(retriesCount);

                console.log(
                    `Retrying ${key} in ${delayMs}ms`
                );

                await sleep(delayMs);

                await updateTransactionState(
                    ref,
                    key,
                    transactionState.new,
                    (current) => {

                        current.retriesCount =
                            retriesCount + 1;

                        /**
                         * intentionally create new dedup key
                         */
                        current.timeStamp = Date.now();

                        current.retryDelayMs = delayMs;

                        current.nextRetryAt =
                            Date.now() + delayMs;
                    }
                );

            } else {

                console.log(
                    `Transaction permanently failed: ${key}`
                );
            }

        } catch (retryErr: any) {

            console.log(
                `Retry scheduling failed`,
                retryErr?.message || retryErr
            );
        }

    } finally {

        /**
         * release slot
         */
        if (LocalCache) {

            if (LocalCache.runningTrace > 0) {
                LocalCache.runningTrace--;
            }
        }

        /**
         * drain pending queue
        */
        await drainPendingQueue(
            defaultCache,
            async (ref, key, snapshot) => {

                await processTransactionPipeline(
                    ref,
                    key,
                    snapshot,
                    defaultCache,
                    initializeFunction,
                    processFunction,
                    finalizeFunction
                );
            }
        ); 
    }
};

/**
 * =========================================================
 * Main listener
 * =========================================================
 */

const Listener_NewTransaction = (
    initFact: boolean,
    ref: Reference,
    defaultCache: performerCache,
    initializeFunction?: (
        snapshot_queueKey: string,
        snapshot_queueData: EventTransactionInfo
    ) => Promise<"valid" | "invalid">,
    processFunction?: (
        snapshot_queueKey: string,
        snapshot_queueData: EventTransactionInfo
    ) => Promise<any | void>,
    finalizeFunction?: (
        snapshot_queueKey: string,
        snapshot_queueData: EventTransactionInfo
    ) => Promise<any | void>
) => {

    return ref
        .orderByChild("state")
        .equalTo(transactionState.new)
        .on(
            'child_added',
            async (snapshot_queue: DataSnapshot) => {

                if (!initFact) return;
                console.log(`Listener_NewTransaction triggered: ${snapshot_queue.key}`);
                try {

                    if (!snapshot_queue.exists()) return;

                    if (snapshot_queue.key == null) return;

                    const key = snapshot_queue.key;
                    const snapshot_queueData: EventTransactionInfo = snapshot_queue.val();
                    //const snapshot_queueData = structuredClone(snapshot_queue.val());
                    if (!snapshot_queueData) return;
                    processTransactionPipeline(
                        ref,
                        key,
                        snapshot_queueData,
                        defaultCache,
                        initializeFunction,
                        processFunction,
                        finalizeFunction
                    );
                    //await updateTransactionState(ref,key,transactionState.successful);

                } catch (err: any) {

                    console.log(
                        `Listener error`,
                        err?.message || err
                    );
                }
            }
        );
};

/**
 * =========================================================
 * Recovery
 * =========================================================
 */

const RecoveryTransactions = async (
    ref: Reference
) => {
    console.log(`Recovery started`);
    const snapshot = await ref.get();
    if (!snapshot.exists()) return;

    const children: DataSnapshot[] = [];
    snapshot.forEach((child) => {
        children.push(child);
    });
    for (const child of children) {
        const key = child.key;
        if (!key) continue;
        const data: EventTransactionInfo = child.val();
        if (
            data.state === transactionState.process ||
            data.state === transactionState.finalize
        ) {
            await updateTransactionState(
                ref,
                key,
                transactionState.failed,
                (current) => {
                    current.output =
                        "recovered after server restart";
                }
            );
        }
    }
};

/**
 * =========================================================
 * Improve as suggestion
 * =========================================================
 *
 * Optional future improvements:
 *
 * 1. graceful shutdown queue drain
 * 2. persistent local queue snapshot
 * 3. worker metrics
 * 4. processing timeout watchdog
 * 5. manual takeover processor
 * 6. queue priority
 * 7. rate limiter
 * 8. circuit breaker
 */

/**
 * =========================================================
 * Export
 * =========================================================
 */

export {
    storageBucket,
    databaseURL,
    app,
    database,
    transactionState,
    ServerInstanceDatabase,
    Listener_NewTransaction,
    RecoveryTransactions
};
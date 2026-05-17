import { initializeApp, cert} from 'firebase-admin/app';
import { getDatabase, Reference ,DataSnapshot } from "firebase-admin/database";
const serviceAccount :any= require('./../ucl-pms-project-firebase-c6b10789f613.json');

import {
    EventTransactionInfo,
} from './type';

const databaseURL = {value:()=>process.env.DATABASE_URL!};
const storageBucket = {value:()=>process.env.STORAGEBUCKET_URL!};

const app = initializeApp({
    credential: cert(serviceAccount),
    storageBucket: storageBucket.value(),
    databaseURL: databaseURL.value()
});

const database = getDatabase(app);
const strPerformerCaches = "PerformerCaches";
const ServerInstanceDatabase = database.ref("/"+process.env.SERVER_INSTANCE_DATABASE||"test");
const PerformerCaches: Reference = ServerInstanceDatabase.child(strPerformerCaches);
var LocalCache: performerCache|null = null;

const transactionState = {new:"new",process:"process",failed:"failed",successful:"successful",pending:"pending",finalize:"finalize",takeover:"takeover"}
type performerCache = {runningTrace:number,maxTrace:number,auth?:uipathToken|null,pendingTrace:pendingTrace}
type pendingTrace = {total:number,traceIDs?:traceIDs}
type traceIDs = {first:string,last:string,data:pendingTracesData}
type pendingTracesData = {[key:string]:{timestamp:number,next?:string}}
type uipathToken = {access_token:string,expires_in:number,expired_time:string,scope:string,token_type:string,folderInfo?:any,requireToken?:true}
const EntryTransactionState:{valid:"valid",invalid:"invalid"} = {valid:"valid",invalid:"invalid"}

const processedTransactions: Map<string, { timestamp: number; state: 'new'|'complete'; version:number }> = new Map();
const processedImage: Map<string, { timestamp: number; queryState: 'new'|'complete'  }> = new Map();
const DEDUP_WINDOW_MS = 60000;
const PROCESSING_LOCK_TIMEOUT_MS = 30000;

const getDeduplicationKey = (
  eventID: string,
  timeStamp: number
): string => {
    return `${eventID}_${timeStamp}`;
};

const isTransactionDuplicate = (eventID: string, timeStamp: number, currentVersion: number = 0): boolean => {
    const key = getDeduplicationKey(eventID, timeStamp);
    const stored = processedTransactions.get(key);
    
    if (!stored) return false;
    
    const age = Date.now() - stored.timestamp;
    if (age > DEDUP_WINDOW_MS) {
        processedTransactions.delete(key);
        return false;
    }
    
    return stored.version <= currentVersion;
};

const markTransactionProcessed = (eventID: string, timeStamp: number, state: 'new'|'complete', version: number): void => {
    const key = getDeduplicationKey(eventID, timeStamp);
    processedTransactions.set(key, { timestamp: Date.now(), state, version });
    
    if (processedTransactions.size > 10000) {
        const oldestEntry = Array.from(processedTransactions.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
        processedTransactions.delete(oldestEntry[0]);
    }
};

const incrementTransactionVersion = (ref: Reference, key: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        ref.child(key).transaction((current: any) => {
            if (!current) return;
            const updated = { ...current, version: (current.version || 0) + 1 };
            return updated;
        }, (error: any, committed: boolean) => {
            if (error) return reject(error);
            resolve(committed);
        });
    });
};

const getRetryDelay = (retryCount:number): number => {
    const baseDelay = 1000;
    const delay = baseDelay * Math.pow(2, retryCount);
    return Math.min(delay, 60000);
};

const updateTransactionState = (ref: Reference, key: string, expectedState: string, newState: string, updateFields?: (transaction:any)=>void): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        ref.child(key).transaction((current: any) => {
            if (!current || current.state !== expectedState) return;
            const updated = { ...current, state: newState };
            if (updateFields) updateFields(updated);
            return updated;
        }, (error:any, committed:boolean) => {
            if (error) return reject(error);
            resolve(committed);
        });
    });
};

const Listener_NewTransaction = (
    initFact:boolean,
    ref:Reference,
    performerCacheName:string,
    defaultCache:performerCache,
    initializeFunction?:(snapshot_queueKey:string,snapshot_queueData:EventTransactionInfo)=>Promise<"valid"|"invalid">,
    processFunction?:(snapshot_queueKey:string,snapshot_queueData:EventTransactionInfo)=>Promise<any|void>)=>{
    return ref.orderByChild("state").equalTo(transactionState.new).on('child_added',async (snapshot_queue:DataSnapshot) => {
    if(!initFact)return;
    try{
        if (!snapshot_queue.exists()) return;
        if (snapshot_queue.key == null) return;
    
        const snapshot_queueKey: string = snapshot_queue.key;
        const snapshot_queueData: EventTransactionInfo = snapshot_queue.val();
        console.log(`New : ${performerCacheName} ${snapshot_queueKey} ${snapshot_queueData.timeStamp}`);
        
        if (isTransactionDuplicate(snapshot_queueData.eventID, snapshot_queueData.timeStamp, snapshot_queueData.version || 0)) {
            console.log(`Duplicate transaction detected: ${snapshot_queueData.eventID} v${snapshot_queueData.version}`);
            return;
        }
        
        //initialization
        let result:"valid"|"invalid"=EntryTransactionState.valid;
        if(initializeFunction && typeof initializeFunction == 'function'){
            result = await initializeFunction(snapshot_queueKey,snapshot_queueData);
        }
        if(result===EntryTransactionState.valid){
            if (!LocalCache) LocalCache = defaultCache;

            if (LocalCache.runningTrace < LocalCache.maxTrace) {
                LocalCache.runningTrace++;
                try {
                    await updateTransactionState(ref, snapshot_queueKey, transactionState.new, transactionState.process, (current) => {
                        if (!current.version) current.version = 0;
                        current.processedAt = Date.now();
                    });
                    markTransactionProcessed(snapshot_queueData.eventID, snapshot_queueData.timeStamp, "new", 0);
                    console.log(`Transaction accepted for processing: ${snapshot_queueData.eventID}`);
                    
                } catch (err:any) {
                    console.log("Failed to mark process:", err.message || err);
                    return;
                }
            }else{
                try {
                    await updateTransactionState(ref, snapshot_queueKey, transactionState.new, transactionState.pending, (current) => {
                        current.output = EntryTransactionState.valid;
                        if (!current.version) current.version = 0;
                    });
                } catch (err:any) {
                    console.log("Failed to mark pending:", err.message || err);
                }
                return;
            }
 
        }else{
            try {
                await updateTransactionState(ref, snapshot_queueKey, transactionState.new, transactionState.failed, (current) => {
                    current.output = "failed by invalid initialization";
                });
            } catch (err:any) {
                console.log("Failed to mark invalid initialization:", err.message || err);
            }
            return;
        }

        //if no return before this line mean it will process the transaction, so we can mark it as processed for deduplication before processFunction to avoid duplicate processing if processing time exceed deduplication window.;
        //Process transaction
        try{
            let output:any;
            if(processFunction&&typeof processFunction=='function')
            output = await processFunction(snapshot_queueKey,snapshot_queueData);
            try {
                await updateTransactionState(ref, snapshot_queueKey, transactionState.process, transactionState.finalize, (current) => {
                    if (output) current.output = output;
                });
            } catch (err:any) {
                console.log("Failed to update to finalize:", err.message || err);
                return;
            } 
        }catch(err:any){
            try {
                await updateTransactionState(ref, snapshot_queueKey, transactionState.process, transactionState.failed, (current) => {
                    current.output = err.message || err;
                });
            } catch (updateErr:any) {
                console.log("Failed to update failed state:", updateErr.message || updateErr);
                
            }
            return;
        }
       
        
    }catch(err:any){
        console.log(`Error new transaction on: ${performerCacheName}`,err.message||err);
    }
    
    });
}

const Listener_PrecessTransaction = (initFact:boolean,ref:Reference,performerCacheName:string,processFunction?:(snapshot_queueKey:string,snapshot_queueData:EventTransactionInfo)=>Promise<any|void>)=>{
    return ref.orderByChild("state").equalTo(transactionState.process).on('child_added',async (snapshot_queue:DataSnapshot) => {
        if(!initFact)return;
        try{
            if(!snapshot_queue.exists())return;
            if(snapshot_queue.key == null)return;
            
            const snapshot_queueKey:string = snapshot_queue.key;
            let snapshot_queueData:EventTransactionInfo = snapshot_queue.val();
            console.log(`Process : ${performerCacheName} ${snapshot_queueKey} ${snapshot_queueData.timeStamp}`);
        
            
            try{
                let output:any;
                if(processFunction&&typeof processFunction=='function')
                    output = await processFunction(snapshot_queueKey,snapshot_queueData);
                try {
                    await updateTransactionState(ref, snapshot_queueKey, transactionState.process, transactionState.finalize, (current) => {
                        if (output) current.output = output;
                        current.processingLocked = false;
                    });
                    //markTransactionProcessed(snapshot_queueData.eventID, snapshot_queueData.timeStamp, transactionState.process, snapshot_queueData.version || 0);
                } catch (err:any) {
                    console.log("Failed to update to finalize:", err.message || err);
                    
                }
            }catch(err:any){
                try {
                    await updateTransactionState(ref, snapshot_queueKey, transactionState.process, transactionState.failed, (current) => {
                        current.output = err.message || err;
                        current.processingLocked = false;
                    });
                } catch (updateErr:any) {
                    console.log("Failed to update failed state:", updateErr.message || updateErr);
                    
                }
            }        
        }catch(err:any){
            console.log(`Error: process transaction on: ${performerCacheName}`,err.message|err)
        }
    
    });
}

const Listener_FailedTransaction=(initFact:boolean,ref:Reference,performerCacheName:string,defaultCache:any)=>{
    return ref.orderByChild("state").equalTo(transactionState.failed).on('child_added',async (snapshot_queue:DataSnapshot) => {
        if(!initFact)return;
        try{
        if(!snapshot_queue.exists())return;
        if(snapshot_queue.key == null)return;
        const snapshot_queueKey:string = snapshot_queue.key;
        let snapshot_queueData:EventTransactionInfo = snapshot_queue.val();
        console.log(`Retry : ${performerCacheName} ${snapshot_queueKey} ${snapshot_queueData.timeStamp}`);
        
        
        PerformerCaches.child(performerCacheName).transaction((currentCache) => {
            if(!initFact)return;
            if (!currentCache) {
                currentCache = defaultCache;
            }
            if(currentCache.runningTrace>0)currentCache.runningTrace--;
            return currentCache;
        }, async (error, committed, snapshot) => {
            if (error) {
                console.log("Transaction failed: " + error.message,error);
            }else{
                if(committed && snapshot_queueData.retriesCount<3){
                    const delayMs = getRetryDelay(snapshot_queueData.retriesCount || 0);
                    const retryTime = Date.now() + delayMs;
                    console.log(`Retrying ${snapshot_queueKey} in ${delayMs}ms (attempt ${snapshot_queueData.retriesCount + 1})`);
                    setTimeout(async () => {
                        try {
                            await updateTransactionState(ref, snapshot_queueKey, transactionState.failed, transactionState.new, (current) => {
                                current.retriesCount = (current.retriesCount || 0) + 1;
                                current.timeStamp = Date.now();
                                current.retryDelayMs = delayMs;
                                current.nextRetryAt = retryTime;
                            });
                        } catch (err:any){
                            console.log("Failed to schedule retry:", err.message || err);
                        }
                    }, delayMs);
                }else{
                    console.log(`Failed : ${performerCacheName} ${snapshot_queueKey}`);
                }
            }
        });
        }catch(err:any){
            console.log(`Error: failed transaction on: ${performerCacheName}`,err.message|err)
        }
    });
}

const Listener_FinalizeTransaction =(initFact:boolean,ref:Reference,performerCacheName:string,defaultCache:any,finalizeFunction?:(snapshot_queueKey:string,snapshot_queueData:EventTransactionInfo)=>Promise<any|void>)=>{
    return ref.orderByChild("state").equalTo(transactionState.finalize).on('child_added',async (snapshot_queue:DataSnapshot) => {
        if(!initFact)return;
        try{
            if(!snapshot_queue.exists())return;
            if(snapshot_queue.key == null)return;
            const snapshot_queueKey:string = snapshot_queue.key;
            const snapshot_queueData:EventTransactionInfo = snapshot_queue.val();
            console.log(`Finalize : ${performerCacheName} ${snapshot_queueKey} ${snapshot_queueData.timeStamp}`);
            
    
            PerformerCaches.child(performerCacheName).transaction((currentCache:performerCache) => {
                if(!initFact)return;
                if (!currentCache) {
                    // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
                    currentCache = defaultCache;
                    //return;
                }
                //trigger pending by delete
                if(currentCache.pendingTrace.traceIDs && currentCache.pendingTrace.traceIDs.data && currentCache.pendingTrace.traceIDs.last && currentCache.pendingTrace.traceIDs.first){
                    const updateTraceIDs:traceIDs = {...currentCache.pendingTrace.traceIDs};
                    const nextNode = updateTraceIDs.data[updateTraceIDs.first].next;
                    if(!nextNode){
                        currentCache.pendingTrace=defaultCache.pendingTrace;
                    }else{
                        //delete first
                        //console.log("delete "+updateTraceIDs.first);
                        delete updateTraceIDs.data[updateTraceIDs.first];
                        updateTraceIDs.first = nextNode;
                        currentCache.pendingTrace.traceIDs = updateTraceIDs;
                    }
                    
                }
                if(currentCache.runningTrace>0)currentCache.runningTrace--;
                return currentCache;
            }, async (error, committed, snapshot) => {
                if (error) {
                    console.log("Transaction failed: " + error.message,error);
                }else if(committed){
                    try{
                        if(finalizeFunction && typeof finalizeFunction=='function')
                            await finalizeFunction(snapshot_queueKey,snapshot_queueData);
                        await updateTransactionState(ref, snapshot_queueKey, transactionState.finalize, transactionState.successful);
                    }catch(err:any){
                        console.log("try to finalize failed.",err.message|err)
                        try {
                            await updateTransactionState(ref, snapshot_queueKey, transactionState.finalize, transactionState.takeover);
                        } catch (updateErr:any) {
                            console.log("Failed to mark takeover:", updateErr.message || updateErr);
                        }
                    }
                    
                }
            });
        }catch(err:any){
            console.log(`Error: finalize transaction on: ${performerCacheName}`,err.message|err)
        }
        
    });
}

const Listener_PendingTransaction = (initFact:boolean,ref:Reference,performerCacheName:string,defaultCache:any)=>{
    return ref.orderByChild("state").equalTo(transactionState.pending).on('child_added',async (snapshot_queue:DataSnapshot) => {
        if(!initFact)return;
        try{
        if (!snapshot_queue.exists()) return;
        if (snapshot_queue.key == null) return;
    
        const snapshot_queueKey: string = snapshot_queue.key;
        const snapshot_queueData: EventTransactionInfo = snapshot_queue.val();
        console.log(`Pending : ${performerCacheName} ${snapshot_queueKey} ${snapshot_queueData.timeStamp}`);

        ref.orderByChild("state").equalTo(transactionState.pending).once('child_removed',async (snapshot_queue:DataSnapshot) => {
            PerformerCaches.child(performerCacheName+"/pendingTrace/total").transaction((totalTransactionUpdate:number|null)=>{
                if(!initFact)return;
                const defaultCache_total = defaultCache.pendingTrace.total;
                if(totalTransactionUpdate==undefined)return defaultCache_total;
                if(totalTransactionUpdate>0)totalTransactionUpdate--;
                return totalTransactionUpdate;
            
            },(err,committed,snapshot)=>{

            })
        })

        
        
        PerformerCaches.child(performerCacheName).transaction((currentCache:performerCache) => {
            if(!initFact)return;
            if (!currentCache) {
                // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
                //return;
                currentCache = defaultCache;
            }
    
            // ตรวจสอบว่า currentRunningTrace < maxRunningTrace หรือไม่
            if (currentCache.runningTrace < currentCache.maxTrace && snapshot_queueData.output == EntryTransactionState.valid) {
                return;
            }else{
                //update pending
                if(typeof currentCache.pendingTrace !== "object"){
                    currentCache.pendingTrace = defaultCache.pendingTrace;
                }
                if(currentCache.pendingTrace.total>0 && currentCache.pendingTrace.traceIDs=== undefined){
                    currentCache.pendingTrace.total = 0;
                }
                const timestamp = Date.now()
                if(currentCache.pendingTrace.traceIDs && currentCache.pendingTrace.traceIDs.data && currentCache.pendingTrace.traceIDs.first && currentCache.pendingTrace.traceIDs.last){
                    const updateTraceIDs={...currentCache.pendingTrace.traceIDs};
                    //check duplicate
                    if(updateTraceIDs.data[snapshot_queueKey]===undefined){
                        //push queue
                        updateTraceIDs.data[snapshot_queueKey] = {timestamp:timestamp};
                        //swap last node with new node
                        const lastNodeKey = updateTraceIDs.last;
                        updateTraceIDs.last =  snapshot_queueKey;
                        updateTraceIDs.data[lastNodeKey].next = snapshot_queueKey;
                        currentCache.pendingTrace.traceIDs = updateTraceIDs;
                        currentCache.pendingTrace.total++;
                        //add listening and change state
                                         
                    }
                }else{
                    currentCache.pendingTrace.traceIDs = {first:snapshot_queueKey,last:snapshot_queueKey,data:{[snapshot_queueKey]:{timestamp:timestamp}}};
                    currentCache.pendingTrace.total++;
    
                }
                
                return currentCache;
            }
            // หาก runningTrace เต็มแล้ว ให้ไม่ทำการเปลี่ยนแปลง
            return; // คืนค่า undefined เพื่อยกเลิก transaction
        }, async (error:any, committed, snapshot) => {
            if (error) {
                console.log("Transaction failed: " + error.message,error);
            } else if (!committed) {
                try {
                    await updateTransactionState(ref, snapshot_queueKey, transactionState.pending, transactionState.new);
                } catch (err:any) {
                    console.log("Failed to reset pending state:", err.message || err);
                }
            }else{
                addListenerToPendingQueue(initFact,ref,snapshot_queueKey,performerCacheName,defaultCache);
            }
        });
        }catch(err:any){
            console.log(`Error: pending transaction on: ${performerCacheName}`,err.message|err)
        }
    
    });
}

const addListenerToPendingQueue= (initFact:boolean,ref:Reference,snapshot_queueKey: string,performerCacheName:string,defaultCache:any)=>{
    const triggerPath = performerCacheName+"/pendingTrace/traceIDs/data/"+snapshot_queueKey
    const timeout = setTimeout(() => {
        console.log(`listener child_removed on ${triggerPath} timeout exceed at 30000ms`)
        PerformerCaches.child(triggerPath).off('child_removed')
        
        //add update transaction to failed
    }, 30000);

    //handle back to new
    PerformerCaches.child(triggerPath).once('child_removed',(pendingDataSnapshot:DataSnapshot)=>{
        if(!initFact)return;
        const pendingTracesData:pendingTracesData = pendingDataSnapshot.val();
        //listen for it to get remove to maintain pendingTrace.
        ref.child(snapshot_queueKey).transaction((pendingTransactionSnapshot:EventTransactionInfo)=>{
            //trigger the transaction to new again.
            if(!pendingTransactionSnapshot) return;
            if(pendingTransactionSnapshot.state === transactionState.pending){
                pendingTransactionSnapshot.state = transactionState.new;
                return pendingTransactionSnapshot;
            }
            return;
        }, async (error, committed, snapshot) => {
            if(committed){
            }
        })
        clearTimeout(timeout);
    })
}

export {storageBucket,databaseURL, app, database, PerformerCaches, transactionState,ServerInstanceDatabase ,Listener_NewTransaction, Listener_PrecessTransaction, Listener_FinalizeTransaction, Listener_FailedTransaction, Listener_PendingTransaction};
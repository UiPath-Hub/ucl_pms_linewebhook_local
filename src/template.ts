import { initializeApp, cert} from 'firebase-admin/app';
import { getDatabase, Reference ,DataSnapshot } from "firebase-admin/database";
const serviceAccount :any= require('./../ucl-pms-project-firebase-c6b10789f613.json');
import {
    LineImageEventTransactionInfo,
} from './type';

const databaseURL = {value:()=>"https://ucl-pms-project-firebase-default-rtdb.asia-southeast1.firebasedatabase.app"};
const storageBucket = {value:()=>"gs://ucl-pms-project-firebase.firebasestorage.app"};

const app = initializeApp({
    credential: cert(serviceAccount),
    storageBucket: storageBucket.value(),
    databaseURL: databaseURL.value()
});

const database = getDatabase(app);
const strPerformerCaches = "PerformerCaches";
const ServerInstanceDatabase = database.ref("/Production");
const PerformerCaches: Reference = ServerInstanceDatabase.child(strPerformerCaches);

const transactionState = {new:"new",process:"process",failed:"failed",successful:"successful",pending:"pending",finalize:"finalize",takeover:"takeover"}
type performerCache = {runningTrace:number,maxTrace:number,auth?:uipathToken|null,pendingTrace:pendingTrace}
type pendingTrace = {total:number,traceIDs?:traceIDs}
type traceIDs = {first:string,last:string,data:pendingTracesData}
type pendingTracesData = {[key:string]:{timestamp:number,next?:string}}
type uipathToken = {access_token:string,expires_in:number,expired_time:string,scope:string,token_type:string,folderInfo?:any,requireToken?:true}
const EntryTransactionState:{valid:"valid",invalid:"invalid"} = {valid:"valid",invalid:"invalid"}

const Listener_NewTransaction = (initFact:boolean,ref:Reference,performerCacheName:string,defaultCache:any,initializeFunction?:(snapshot_queueKey:string,snapshot_queueData:LineImageEventTransactionInfo)=>Promise<"valid"|"invalid">)=>{
    return ref.orderByChild("state").equalTo(transactionState.new).on('child_added',async (snapshot_queue:DataSnapshot) => {
    if(!initFact)return;
    try{
        if (!snapshot_queue.exists()) return;
        if (snapshot_queue.key == null) return;
    
        const snapshot_queueKey: string = snapshot_queue.key;
        const snapshot_queueData: LineImageEventTransactionInfo = snapshot_queue.val();
        console.log(`New : ${performerCacheName} ${snapshot_queueKey}`);
        let result:"valid"|"invalid"=EntryTransactionState.valid;
        if(initializeFunction && typeof initializeFunction == 'function'){
            result = await initializeFunction(snapshot_queueKey,snapshot_queueData);
        }
        if(result===EntryTransactionState.valid){
            PerformerCaches.child(performerCacheName).transaction((currentCache:performerCache) => {
                if(!initFact)return;
                if (!currentCache) {
                    // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
                    //return;
                    currentCache = defaultCache;
                }
        
                // ตรวจสอบว่า currentRunningTrace < maxRunningTrace หรือไม่
                if (currentCache.runningTrace < currentCache.maxTrace) {
                    currentCache.runningTrace++;
                    return currentCache; // ส่งค่าที่อัปเดตกลับไปยัง Firebase
                }
                // หาก runningTrace เต็มแล้ว ให้ไม่ทำการเปลี่ยนแปลง
                return; // คืนค่า undefined เพื่อยกเลิก transaction
            }, async (error:any, committed, snapshot) => {
                if (error) {
                    console.log("Transaction failed: " + error.message,error);
                } else if (!committed) {
                    snapshot_queueData.state = transactionState.pending;
                    snapshot_queueData.output = EntryTransactionState.valid
                    ref.child(snapshot_queueKey).update(snapshot_queueData)
                } else {
                    snapshot_queueData.state = transactionState.process;
                    ref.child(snapshot_queueKey).update(snapshot_queueData)
                }
            });    
        }else{
            snapshot_queueData.state = transactionState.pending;
            snapshot_queueData.output = EntryTransactionState.invalid;
            ref.child(snapshot_queueKey).update(snapshot_queueData);
        }
        
    }catch(err:any){
        console.log(`Error new transaction on: ${performerCacheName}`,err.message||err);
    }
    
    });
}

const Listener_PrecessTransaction = (initFact:boolean,ref:Reference,performerCacheName:string,processFunction?:(snapshot_queueKey:string,snapshot_queueData:LineImageEventTransactionInfo)=>Promise<any|void>)=>{
    return ref.orderByChild("state").equalTo(transactionState.process).on('child_added',async (snapshot_queue:DataSnapshot) => {
        if(!initFact)return;
        try{
            if(!snapshot_queue.exists())return;
            if(snapshot_queue.key == null)return;
            
            const snapshot_queueKey:string = snapshot_queue.key;
            let snapshot_queueData:LineImageEventTransactionInfo = snapshot_queue.val();
            console.log(`Process : ${performerCacheName} ${snapshot_queueKey}`);
            try{
                let output;
                if(processFunction&&typeof processFunction=='function')
                output = await processFunction(snapshot_queueKey,snapshot_queueData);
                snapshot_queueData.state = transactionState.finalize;
                if(output)snapshot_queueData.output = output;
                ref.child(snapshot_queueKey).update(snapshot_queueData);
            }catch(err:any){
                snapshot_queueData.state = transactionState.failed;
                snapshot_queueData.output = err.message||err;
                ref.child(snapshot_queueKey).update(snapshot_queueData);
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
        let snapshot_queueData:LineImageEventTransactionInfo = snapshot_queue.val();
        console.log(`Retry : ${performerCacheName} ${snapshot_queueKey}`);
        
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
                    snapshot_queueData.state = transactionState.new;
                    snapshot_queueData.retriesCount++
                    snapshot_queueData.timeStamp = Date.now();
                    setTimeout(()=>ref.child(snapshot_queueKey).update(snapshot_queueData),1000);
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

const Listener_FinalizeTransaction =(initFact:boolean,ref:Reference,performerCacheName:string,defaultCache:any,finalizeFunction?:(snapshot_queueKey:string,snapshot_queueData:LineImageEventTransactionInfo)=>Promise<any|void>)=>{
    return ref.orderByChild("state").equalTo(transactionState.finalize).on('child_added',async (snapshot_queue:DataSnapshot) => {
        if(!initFact)return;
        try{
            if(!snapshot_queue.exists())return;
            if(snapshot_queue.key == null)return;
            const snapshot_queueKey:string = snapshot_queue.key;
            const snapshot_queueData:LineImageEventTransactionInfo = snapshot_queue.val();
            console.log(`Finalize : ${performerCacheName} ${snapshot_queueKey}`);
    
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
                        snapshot_queueData.state = transactionState.successful;
                        ref.child(snapshot_queueKey).update(snapshot_queueData);
                    }catch(err:any){
                        console.log("try to finalize failed.",err.message|err)
                        snapshot_queueData.state = transactionState.takeover;
                        ref.child(snapshot_queueKey).update(snapshot_queueData);
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
        const snapshot_queueData: LineImageEventTransactionInfo = snapshot_queue.val();
        console.log(`Pending : ${performerCacheName} ${snapshot_queueKey}`);

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
                snapshot_queueData.state = transactionState.new;
                ref.child(snapshot_queueKey).update(snapshot_queueData);
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
        ref.child(snapshot_queueKey).transaction((pendingTransactionSnapshot:LineImageEventTransactionInfo)=>{
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
//import * as logger from "firebase-functions/logger";
import moment from 'moment-timezone';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getDatabase, Reference ,DataSnapshot } from "firebase-admin/database";
import { Storage, Bucket, File } from '@google-cloud/storage';
import { defineSecret, databaseURL, storageBucket, defineString } from 'firebase-functions/params';
import { Request } from 'express';
//import { Door } from './lock';
import { Response } from 'express';
import { PassThrough } from 'stream';
import axios from 'axios';
import {AxiosResponse} from 'axios';
//const { defineSecret } = require('firebase-functions/params');
import { AbortController } from 'node-abort-controller';

const qs = require('qs');
//require('./../tk.json');
const serviceAccount :any= require('./../ucl-pms-project-firebase-c6b10789f613.json');
const channelAccessToken: StringParam = defineString("LINE_CHANNEL_ACCESS_TOKEN");
const UIpathAppID: StringParam = defineString("UIPATH_APP_ID");
const UIpathAppSecret: StringParam = defineString("UIPATH_APP_SECRET");
const UIpathCloudTenantAddress: StringParam = defineString("UIPATH_CLOUD_TENANT_ADDRESS");

import {
    method,
    RequestContent,
    BlobToBase64,
    SaveImageInfo,
    Emoji,
    Mentionee,
    Mention,
    MessagesHistory,
    TextMessage,
    ReplyMessages,
    PendingApprovalQueue,
    UnrecognizedImagesContent,
    ImageMessage,
    UipathTokenObject,
    ODataContext,
    Folder,
    QueueItemDataDto,
    TK,
    HTTPRequest,
    LineImageEventTransactionInfo,
} from './type';
import { StringParam } from "firebase-functions/lib/params/types";

/*const storageBucketName = "bararobotapi.appspot.com";
//const databaseURL = "bararobotapi-default-rtdb.asia-southeast1.firebasedatabase.app";
// Initialize Firebase Admin SDK
const serviceAccount = require('./../bararobotapi-firebase-adminsdk-s9wzn-ff51b26315.json');
initializeApp({
    credential: cert(serviceAccount),
    storageBucket: 'gs://' + storageBucketName,
    databaseURL: "https://" + databaseURL
});*/

initializeApp({
    credential: cert(serviceAccount),
    storageBucket: storageBucket.value(),
    databaseURL: databaseURL.value()
});

const lineEventRef = "line_events";
const ImageEventPerformerName = "ImageEvents";
const CallUipathAPIEventPerformerName = "UiPathEvents";
const bucket: Bucket = getStorage().bucket();
const ServerInstanceDatabase = getDatabase().ref("/"+Date.now().toString());
const LineEventsLogStorage: Reference = ServerInstanceDatabase.child(lineEventRef);
const PerformerCaches: Reference = ServerInstanceDatabase.child("PerformerCaches");
const AuthRequireTrigger: Reference = ServerInstanceDatabase.child("AuthRequireTrigger");
const LineTransactionQueue: Reference = ServerInstanceDatabase.child("ImageTransactions");
const authenticationStorage: Reference = ServerInstanceDatabase.child('Authentication');
const ReplyMessagesQueues: Reference = ServerInstanceDatabase.child('ReplyMessages');
const TextMessagesHistory: Reference = ServerInstanceDatabase.child('TextMessagesHistory');
const CallUipathAPITransactionQueue: Reference = ServerInstanceDatabase.child('UiPathAPITransactions');

const transactionState = {new:"new",process:"process",failed:"failed",successful:"successful",pending:"pending"}

const getRealtimeDatabase = (storage: Reference, key: string, trace: string): Promise<any> => {
    console.log(`start getRealtimeDatabase(key:${key},trace:${trace}): ${moment().tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm.ss")}`)
    return new Promise((resolve, reject) => {
        storage.child(`${key}/${trace}`).once(
            'value',
            async (snapshot) => {
                resolve(snapshot.val());
            },
            (errorObject) => {
                console.log('The data read failed: ' + errorObject.name);
                reject(new Error('The data read failed: ' + errorObject.name));
            }
        )
    });
};
const setRealtimeDatabase = async (storage: Reference, data: any, key: string, trace: string): Promise<void> => {
    //console.log(`start setRealtimeDatabase(trace:${trace},data:${data.toString()|data}): ${moment().tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm.ss")}`)
    const useRef = storage.child(`${key}/${trace}`);
    useRef.set(data, (err) => {
        if (err) {
            console.log(`set ${trace} Error: ${err}`);
            return Promise.reject(err);
        } else return Promise.resolve();
    });
};

const getLineImage = async (message: ImageMessage,messageName: string, save_date: string): Promise<SaveImageInfo> => {
    console.log("start getLineImage():" + moment().tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm.ss"));
    const controller = new AbortController(); // สร้าง AbortController
    const signal = controller.signal;
    let lineResponse:AxiosResponse<any, any>|null;
    const timer = setTimeout(() => {
        controller.abort(); // ยกเลิกคำขอหลังจาก timeout
    }, 10000);
    const header = {
        'content-type': 'application/json; charset=UTF-8',
        accept: 'application/json',
        Authorization: 'Bearer ' + channelAccessToken.value().trim(),
    };
    if (message.contentProvider.type == 'line') {
        try {    

            lineResponse = await axios({
                url: `https://api-data.line.me/v2/bot/message/${message.id}/content`,
                method: 'GET',
                headers: header,
                responseType: 'arraybuffer', // ใช้ arraybuffer แทน blob
                //timeout: 5000,
                signal:signal
            });
        } catch (err: any) {
            if (axios.isCancel(err)) {
                console.log('Request canceled due to timeout');
            } else if (err.name === 'AbortError') {
                console.log('Request aborted');
            }else{
                console.log("Get Image from Line content failure:"+err.message||err);
            }
            throw new Error(`Get Image from Line content failure: ${err.message||err}`);
        }finally {
            clearTimeout(timer); // ยกเลิกตัวจับเวลาถ้าคำขอสำเร็จหรือถูกยกเลิก
        }
        // Convert response data directly to Buffer
        if(lineResponse){
            try{
                const buffer = Buffer.from(lineResponse.data);
                const [mimeType, extension] = lineResponse.headers['content-type'].split('/'); // ใช้ headers แทน data.type

                // Construct file path and access file reference
                const filePath = `images/${save_date}/img${messageName}.${extension}`;
                const file = bucket.file(filePath);

                // Upload the buffer data with metadata and return result
                await file.save(buffer, {
                metadata: { contentType: lineResponse.headers['content-type'] },
                public: true,
                });            

                return { publicURL: file.publicUrl(), filePath };
            }catch(err:any){
                console.log("Save Image from Line content failure:"+err.message||err);
                throw new Error(`Save Image from Line content failure: ${err.message||err}`);
            }
        
        }else{ 
            console.log("Unknown Image Response.");
            throw new Error(`Unknown Image Response.`);
        }
    } else {
        throw new Error(`The Image is provided by external location.`);
    }
}

const getAndSaveLineImage = async (
    logKey:string,
    message: ImageMessage,
    save_date: string
): Promise<SaveImageInfo> => {
    console.log(`start getAndSaveLineImage(): ${moment().tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm:ss")}`);
    const image_name = `${message.id}${message.imageSet?.index != undefined ? 'i' + message.imageSet?.index : '1'}_${Date.now().toString()}`;

    const saveImageInfo = await getLineImage(message, image_name, save_date);
    return saveImageInfo;
};

const AddUiPathQueueItem = async (itemData: QueueItemDataDto) => {
    console.log("start AddQueueItem():" + moment().tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm.ss"));
    const uiPathAuth: uipathToken = await getRealtimeDatabase(PerformerCaches,CallUipathAPIEventPerformerName,"auth");
    const folder_info: Folder = uiPathAuth.folderInfo;
    const queue_detail: { "itemData": QueueItemDataDto } = {
        "itemData": itemData
    }
    //console.log("queue detail:" + JSON.stringify(queue_detail));
    await axios({
        url:UIpathCloudTenantAddress.value().trim().replace(/\/$/, "") + "/orchestrator_/odata/Queues/UiPathODataSvc.AddQueueItem",
        method:"POST",
        headers:{ "Authorization": `${uiPathAuth.token_type} ${uiPathAuth.access_token}`, "X-UIPATH-OrganizationUnitId": folder_info.Id, "accept": "application/json", "Content-Type": "application/json;odata.metadata=minimal;odata.streaming=true" },
        data:JSON.stringify(queue_detail),
        //timeout: 15000
    }).catch((err)=>{
        throw new Error(err.message) || err
    })
    
}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////

type performerCache = {runningTrace:number,maxTrace:number,auth?:uipathToken|null,pendingTrace:number}
const DefaultImageEventPerformerCache:performerCache = {runningTrace: 0, maxTrace: 1,pendingTrace:0}
LineTransactionQueue.orderByChild("state").equalTo(transactionState.new).on('child_added',async (snapshot_queue:DataSnapshot) => {
    if (!snapshot_queue.exists()) return;
    if (snapshot_queue.key == null) return;

    const snapshot_queueKey: string = snapshot_queue.key;
    console.log("New image: " + snapshot_queueKey);
    
    PerformerCaches.child(ImageEventPerformerName).transaction((currentCache) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            currentCache = DefaultImageEventPerformerCache;
        }

        // ตรวจสอบว่า currentRunningTrace < maxRunningTrace หรือไม่
        if (currentCache.runningTrace < currentCache.maxTrace) {
            currentCache.runningTrace++;
            return currentCache; // ส่งค่าที่อัปเดตกลับไปยัง Firebase
        }
        // หาก runningTrace เต็มแล้ว ให้ไม่ทำการเปลี่ยนแปลง
        return; // คืนค่า undefined เพื่อยกเลิก transaction
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message,error);
        } else if (!committed) {
            //console.log("Transaction not committed. Queue moved to pending.");
            const snapshot_queueData: LineImageEventTransactionInfo = snapshot_queue.val();
            snapshot_queueData.state = transactionState.pending;
             LineTransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
        } else {
            //console.log("Transaction committed successfully.");
            const snapshot_queueData: LineImageEventTransactionInfo = snapshot_queue.val();
            snapshot_queueData.state = transactionState.process;
            LineTransactionQueue.child(snapshot_queueKey).update(snapshot_queueData)
        }
    });
});

LineTransactionQueue.orderByChild("state").equalTo(transactionState.process).on('child_added',async (snapshot_queue:DataSnapshot) => {
    if(!snapshot_queue.exists())return;
    if(snapshot_queue.key == null)return;
    const snapshot_queueKey:string = snapshot_queue.key;
    console.log("process image: "+ snapshot_queueKey);
    let snapshot_queueData:LineImageEventTransactionInfo = snapshot_queue.val();
    try{
        const line_event = await getRealtimeDatabase(LineEventsLogStorage,snapshot_queueData.eventID,'');
        if(line_event == undefined){
            console.log("line_events log not found.");
            throw new Error("line_events log not found.");}
        const saveImageInfo = await getAndSaveLineImage(snapshot_queueData.eventID,line_event.event.message,snapshot_queueData.date);
        //const event =await getRealtimeDatabase(LineEventsLogStorage,newCallUipathAPIQueue.eventID,"event");
        if (saveImageInfo != undefined) {
            await setRealtimeDatabase(LineEventsLogStorage, 'true', snapshot_queueData.eventID, 'getImg');
            await setRealtimeDatabase(LineEventsLogStorage, saveImageInfo, snapshot_queueData.eventID, 'saveImgPath');
        }
        snapshot_queueData.state = transactionState.successful;
        snapshot_queueData.output = saveImageInfo;
        LineTransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
    }catch(err:any){
        snapshot_queueData.state = transactionState.failed;
        snapshot_queueData.output = err.message||err;
        LineTransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
    }
});

LineTransactionQueue.orderByChild("state").equalTo(transactionState.failed).on('child_added',async (snapshot_queue:DataSnapshot) => {
    if(!snapshot_queue.exists())return;
    if(snapshot_queue.key == null)return;
    const snapshot_queueKey:string = snapshot_queue.key;
    console.log("retry image: "+ snapshot_queueKey);
    let snapshot_queueData:LineImageEventTransactionInfo = snapshot_queue.val();

    PerformerCaches.child(ImageEventPerformerName).transaction((currentCache) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            return;
        }
        currentCache.runningTrace--;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message,error);
        }else{
            if(committed && snapshot_queueData.retriesCount<3){
                snapshot_queueData.state = transactionState.new;
                snapshot_queueData.retriesCount++
                snapshot_queueData.timeStamp = Date.now();
                setTimeout(()=>LineTransactionQueue.child(snapshot_queueKey).update(snapshot_queueData),1000);
            }
        }
    });
    
});

LineTransactionQueue.orderByChild("state").equalTo(transactionState.successful).on('child_added',async (snapshot_queue:DataSnapshot) => {
    if(!snapshot_queue.exists())return;
    if(snapshot_queue.key == null)return;
    const snapshot_queueKey:string = snapshot_queue.key;
    console.log("successful image: "+ snapshot_queueKey);
    const newCallUipathAPIQueue:LineImageEventTransactionInfo = snapshot_queue.val()
    newCallUipathAPIQueue.state = transactionState.new
    CallUipathAPITransactionQueue.push(newCallUipathAPIQueue);
    /*let saveImageInfo=newCallUipathAPIQueue.output;
    const event =await getRealtimeDatabase(LineEventsLogStorage,newCallUipathAPIQueue.eventID,"event");
    if (saveImageInfo != undefined) {
        setRealtimeDatabase(LineEventsLogStorage, 'true', newCallUipathAPIQueue.eventID, 'getImg');
        setRealtimeDatabase(LineEventsLogStorage, saveImageInfo, newCallUipathAPIQueue.eventID, 'saveImgPath');
        const content: UnrecognizedImagesContent = { 
            "LineEvent": JSON.stringify(event), 
            "StorageBucket": storageBucket.value(), 
            "PublicImageURL": saveImageInfo.publicURL, 
            "ImagePath": saveImageInfo.filePath, 
            "LogURL": databaseURL.value() + "/" +lineEventRef + "/" + newCallUipathAPIQueue.eventID, "CreateDate": newCallUipathAPIQueue.date + " " + newCallUipathAPIQueue.time 
        };
        const queue_detail: QueueItemDataDto = {
            "Name": "UnrecognizedImages",
            "Priority": "Normal",
            "Reference": newCallUipathAPIQueue.eventID,
            "SpecificContent": content
        }

        await AddQueueItem(queue_detail);
    //}*/  

    PerformerCaches.child(ImageEventPerformerName).transaction((currentCache) => {
        if (!currentCache) {
            return;
        }
        currentCache.runningTrace--;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message,error);
        }
    });
});

LineTransactionQueue.orderByChild("state").equalTo(transactionState.pending).on('child_added',async (snapshot_queue:DataSnapshot)=>{
    PerformerCaches.child(ImageEventPerformerName).transaction((currentCache:performerCache|null) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            currentCache = DefaultImageEventPerformerCache;
        }
        currentCache.pendingTrace++;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message,error);
        }
    });
})
LineTransactionQueue.orderByChild("state").equalTo(transactionState.pending).on('child_removed',async (snapshot_queue:DataSnapshot)=>{
    PerformerCaches.child(ImageEventPerformerName).transaction((currentCache:performerCache|null) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            currentCache = DefaultImageEventPerformerCache;
        }
        if(currentCache.pendingTrace-1>=0)
        currentCache.pendingTrace--;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message,error);
        }
    });
})
var triggerLineEventPending = false;
PerformerCaches.child(ImageEventPerformerName).on('value', (snapshot_performerCache) => {
    const performerCache = snapshot_performerCache.val();
    if (!performerCache) return;

    const currentRunningTrace = performerCache.runningTrace;
    const maxRunningTrace = performerCache.maxTrace;
    console.log("ImageEventPerformerName Trigger")
    if (currentRunningTrace < maxRunningTrace) {
        // ดึง queue ที่อยู่ในสถานะ pending
        if(triggerLineEventPending)return;
        triggerLineEventPending = true;
        setTimeout(() => {
            triggerLineEventPending=false;
        }, 1000);
        LineTransactionQueue.orderByChild("state").equalTo(transactionState.pending).once('value', async (snapshot_pending) => {
            if (!snapshot_pending.exists()) return;

            const updates: Record<string, any> = {};
            let count = maxRunningTrace - currentRunningTrace; // จำนวน queue ที่สามารถนำกลับมาเป็น new ได้

            snapshot_pending.forEach((childSnapshot) => {
                if (count <= 0) return; // หยุดเมื่อ trace เต็ม
                const key = childSnapshot.key;
                if (key) {
                    updates[`${key}/state`] = transactionState.new;
                    count--;
                }
            });

            if (Object.keys(updates).length > 0) {
                await LineTransactionQueue.update(updates);
                
                console.log(`Moved ${Object.keys(updates).length} pending queues back to new.`);
            }
            triggerLineEventPending=false;
        });
    }
});

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
type uipathToken = {access_token:string,expries_in:number,exprires_time:string,scope:string,token_type:string,folderInfo?:any,requireToken?:true}
var getAuthenticationProcessRunning=false;
//PerformerCaches.child(CallUipathAPIEventPerformerName):{runningTrace:number,maxTrace:number,auth?:uipathToken|null}
const reauth =async ()=>{
    /*PerformerCaches.child(CallUipathAPIEventPerformerName+"Static").transaction((snapshot)=>{
        if(!snapshot){
            snapshot = {GettingToken:true}
        }else{
            if(snapshot.GettingToken===true)return;
            else snapshot.GettingToken=true;
        }
        return snapshot;

    },async (error,commited,snapshot)=>{
        if(!error && commited){
            //if(!getAuthenticationProcessRunning){
            
        //}
        
        //auth.changed
        }
    //})*/
    if(getAuthenticationProcessRunning)return;   
    setTimeout(()=>getAuthenticationProcessRunning=false,5000);
    getAuthenticationProcessRunning=true;
    console.log("re-authentication");
    const clientId = UIpathAppID.value().trim();
    const clientSecret = UIpathAppSecret.value().trim().replace(/\\/g, "");
    //console.log(`${clientId} @@ ${UIpathAppSecret.value()} @@ ${clientSecret}`);
    const uipathScope = 'OR.Folders.Read OR.Queues.Read OR.Queues.Write';
    const url = 'https://cloud.uipath.com/identity_/connect/token';
    const method = 'POST';
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const data = qs.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: uipathScope
    });
    
    const response =  await axios({url,method,headers,data,timeout: 15000})
    if(response.data){
        response.data.expires_time = moment().tz('Asia/Bangkok').add(moment.duration(response.data.expires_in - 60, 'seconds')).format('YYYYMMDDHHmmssSSS');
        const accessToken = `${response.data.token_type} ${response.data.access_token}`;
        const MainURL = UIpathCloudTenantAddress.value().trim().replace(/\/$/, "") + "/orchestrator_/odata/Folders";
        const filter_properties = "FullyQualifiedName";
        const compare_value = "Non Production/Meter_Record";
        const folderInfoResponse = await axios({
            url:`${MainURL}?%24filter=${filter_properties}%20eq%20%27${compare_value}%27`,
            method:"GET",
            headers:{ 'accept': 'application/json', 'Authorization': accessToken},
            timeout: 15000
        })
        if(folderInfoResponse.data){
            if(parseInt(folderInfoResponse.data["@odata.count"])>0){
                const folder_info = folderInfoResponse.data.value[0];
            response.data.folderInfo = folder_info;
            //console.log(response.data);
            await PerformerCaches.child(CallUipathAPIEventPerformerName+"/auth").set(response.data,(err)=>{if(err)console.log("Could not set auth data."+err.message||err)});
            getAuthenticationProcessRunning=false;
            return;
                //.then(()=>{
            //PerformerCaches.child(CallUipathAPIEventPerformerName+"Static").update({GettingToken:false},(err)=>console.log("Could not update CallUipathAPIEventPerformerNameStatic/GettingToken"+err?.message||err))
            //});
            }
        }else console.log("Unknown folderInfoResponse.",folderInfoResponse);
    }else console.log("Unknown response.",response);
  
}

/*PerformerCaches.child(CallUipathAPIEventPerformerName+"Static/GettingToken").on('value', (snapshot_cache:DataSnapshot)=>{
    const reauthTrace =async ()=>{
        await PerformerCaches.child(CallUipathAPIEventPerformerName+"Static/GettingToken").set(true)
        await reauth();
        await PerformerCaches.child(CallUipathAPIEventPerformerName+"Static/GettingToken").set(false)
    }
    if (snapshot_cache.exists()){
        if(!snapshot_cache.val()){
            PerformerCaches.child(CallUipathAPIEventPerformerName+"/auth").once('value',(snapshot)=>{
                const auth:uipathToken= snapshot.val();
                if(auth.exprires_time!=null){
                    const tokenExpiresMoment = moment(auth.exprires_time, 'YYYYMMDDHHmmssSSS').tz('Asia/Bangkok');
                    // ตรวจสอบว่า token หมดอายุหรือยัง
                    const isTokenExpired = moment().tz('Asia/Bangkok').isAfter(tokenExpiresMoment);
                    if(isTokenExpired){
                        reauthTrace();
                    }else return;
                }else{
                    reauthTrace();
                }
            })            
        }

    }else{
        reauthTrace();
    }
//})*/
const DefaultCallUipathAPIEventPerformerCache:performerCache =  {runningTrace:0,maxTrace:1,pendingTrace:0}
CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.new).on('child_added',async (snapshot_queue:DataSnapshot) => {
    if (!snapshot_queue.exists()) return;
    if (snapshot_queue.key == null) return;

    const snapshot_queueKey: string = snapshot_queue.key;
    console.log("New CallUipathAPI: " + snapshot_queueKey);

    
    PerformerCaches.child(CallUipathAPIEventPerformerName).transaction((currentCache:performerCache|null) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            currentCache = DefaultCallUipathAPIEventPerformerCache;
        }

        // ตรวจสอบว่า currentRunningTrace < maxRunningTrace หรือไม่
        if (currentCache.runningTrace < currentCache.maxTrace && currentCache.auth != undefined) {
            const auth:uipathToken=currentCache.auth;
            if (isTokenExpired(auth)) {
                //currentCache.auth = null;
                return;
            } else {
                currentCache.runningTrace++;
                return currentCache;
            }
            
        }
        return;

    }, async (error:Error|null, committed:boolean, snapshot_newCache:DataSnapshot|null) => {
        if (error) {
            console.log("Transaction failed: " + error.message,error);
        } else if (!committed) {
            //console.log("Transaction not committed. Queue moved to pending.");
            const snapshot_queueData: LineImageEventTransactionInfo = snapshot_queue.val();
            snapshot_queueData.state = transactionState.pending;
            snapshot_queueData.output = "RunningTrace full or Authentication token not valid"
            await CallUipathAPITransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
        } else if(committed){
            //logger.log("snapshot"+JSON.stringify( snapshot_newCache?.val()));
            if(snapshot_newCache?.exists()){
            const newCache:performerCache = snapshot_newCache.val();
            const snapshot_queueData: LineImageEventTransactionInfo = snapshot_queue.val();
            snapshot_queueData.state = newCache.auth?transactionState.process:transactionState.pending;
            await CallUipathAPITransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
            }else console.log("commited without snapshot_newCache");

        }
    });
});

CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.process).on('child_added',async (snapshot_queue:DataSnapshot) => {
    if(!snapshot_queue.exists())return;
    if(snapshot_queue.key == null)return;
    const snapshot_queueKey:string = snapshot_queue.key;
    console.log("process CallUipathAPI: "+ snapshot_queueKey);
    let snapshot_queueData:LineImageEventTransactionInfo = snapshot_queue.val();
    try{
        const line_event = await getRealtimeDatabase(LineEventsLogStorage,snapshot_queueData.eventID,'event');
        if(line_event == undefined){
            console.log("line_events log not found.");
            throw new Error("line_events log not found.");
        }
        ///////////////////
        let saveImageInfo= await getRealtimeDatabase(LineEventsLogStorage,snapshot_queueData.eventID,"saveImgPath");
        if (saveImageInfo != undefined) {
            //setRealtimeDatabase(LineEventsLogStorage, 'true', snapshot_queueData.eventID, 'getImg');
            //setRealtimeDatabase(LineEventsLogStorage, saveImageInfo, snapshot_queueData.eventID, 'saveImgPath');
            const content: UnrecognizedImagesContent = {
                "LineEvent": JSON.stringify(line_event), 
                "StorageBucket": storageBucket.value(), 
                "PublicImageURL": saveImageInfo.publicURL, 
                "ImagePath": saveImageInfo.filePath, 
                "LogURL": databaseURL.value() + "/" +lineEventRef + "/" + snapshot_queueData.eventID, "CreateDate": snapshot_queueData.date + " " + snapshot_queueData.time 
            };
            const queue_detail: QueueItemDataDto = {
                "Name": "UnrecognizedImages",
                "Priority": "Normal",
                "Reference": snapshot_queueData.eventID,
                "SpecificContent": content
            }

            await AddUiPathQueueItem(queue_detail);
        }else{
            throw new Error("saveImageInfo not found.");
        }
        ///////////////////
        //const saveImageInfo = "test"//await getAndSaveLineImage(snapshot_queueData.eventID,line_event.event.message,snapshot_queueData.date);
        snapshot_queueData.state = transactionState.successful;
        CallUipathAPITransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
    }catch(err:any){
        snapshot_queueData.state = transactionState.failed;
        snapshot_queueData.output = err.message||err;
        CallUipathAPITransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
    }
});

CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.failed).on('child_added',async (snapshot_queue:DataSnapshot) => {
    if(!snapshot_queue.exists())return;
    if(snapshot_queue.key == null)return;
    const snapshot_queueKey:string = snapshot_queue.key;
    console.log("retry CallUipathAPI: "+ snapshot_queueKey);
    let snapshot_queueData:LineImageEventTransactionInfo = snapshot_queue.val();

    PerformerCaches.child(CallUipathAPIEventPerformerName).transaction((currentCache:performerCache|null) => {
        if (!currentCache) {
            return;
        }
        currentCache.runningTrace--;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message,error);
        }else{
            if(committed && snapshot_queueData.retriesCount<3){
                snapshot_queueData.state = transactionState.new;
                snapshot_queueData.retriesCount++
                snapshot_queueData.timeStamp = Date.now();
                setTimeout(()=>CallUipathAPITransactionQueue.child(snapshot_queueKey).update(snapshot_queueData),1000);
            }
        }
    });
    
});

CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.successful).on('child_added',async (snapshot_queue:DataSnapshot) => {
    if(!snapshot_queue.exists())return;
    if(snapshot_queue.key == null)return;
    const snapshot_queueKey:string = snapshot_queue.key;
    console.log("successful CallUipathAPI: "+ snapshot_queueKey);
    PerformerCaches.child(CallUipathAPIEventPerformerName).transaction((currentCache:performerCache|null) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            return;
        }
        currentCache.runningTrace--;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message,error);
        }
    });
});

CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.pending).on('child_added',async (snapshot_queue:DataSnapshot)=>{
    PerformerCaches.child(CallUipathAPIEventPerformerName).transaction((currentCache:performerCache|null) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            currentCache = DefaultCallUipathAPIEventPerformerCache;
        }
        currentCache.pendingTrace++;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message,error);
        }
    });
})
CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.pending).on('child_removed',async (snapshot_queue:DataSnapshot)=>{
    PerformerCaches.child(CallUipathAPIEventPerformerName).transaction((currentCache:performerCache|null) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            currentCache = DefaultCallUipathAPIEventPerformerCache;
        }
        if(currentCache.pendingTrace-1>=0)
        currentCache.pendingTrace--;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message,error);
        }
    });
})

const isTokenExpired = (auth:uipathToken|null)=>{
    if(!auth)return false;
    if(!auth.exprires_time)return false;
    const tokenExpiresMoment = moment(auth.exprires_time, 'YYYYMMDDHHmmssSSS').tz('Asia/Bangkok');
    const isTokenExpired = moment().tz('Asia/Bangkok').isAfter(tokenExpiresMoment);
    return isTokenExpired;
}
var triggerCallAPIPending = false;
PerformerCaches.child(CallUipathAPIEventPerformerName).on('value', (snapshot_performerCache:DataSnapshot) => {
    //Trigger: New.added #transaction=>runningTrace.changed, Successful.added #transaction=>runningTrace.changed, Failed.added #transaction=>runningTrace.changed
    const performerCache:performerCache|null = snapshot_performerCache.val();
    if (!performerCache) return;

    const currentRunningTrace = performerCache.runningTrace||1;
    const maxRunningTrace = performerCache.maxTrace||1;
    const auth = performerCache.auth;

    if (currentRunningTrace < maxRunningTrace  && auth != undefined) {
        if(isTokenExpired(auth)){
            reauth();
            return;
        }
        // ดึง queue ที่อยู่ในสถานะ pending
        else{ 
            if(triggerCallAPIPending)return;
            triggerCallAPIPending = true;
            setTimeout(() => {
                triggerCallAPIPending=false;
            }, 1000);
            CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.pending).once('value', async (snapshot_pending) => {
                if (!snapshot_pending.exists()) return;
                const updates: Record<string, any> = {};
                let count = maxRunningTrace - currentRunningTrace; // จำนวน queue ที่สามารถนำกลับมาเป็น new ได้

                snapshot_pending.forEach((childSnapshot) => {
                    if (count <= 0) return; // หยุดเมื่อ trace เต็ม
                    const key = childSnapshot.key;
                    if (key) {
                        updates[`${key}/state`] = transactionState.new;
                        count--;
                    }
                });

                if (Object.keys(updates).length > 0) {
                    await CallUipathAPITransactionQueue.update(updates);
                    
                    //console.log(`Moved ${Object.keys(updates).length} pending queues back to new.`);
                }
                triggerCallAPIPending=false;
            });
        }
    }else if(auth == undefined){
        reauth();
    }
});

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
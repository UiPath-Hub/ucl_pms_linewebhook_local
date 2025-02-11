"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//const logger = require("firebase-functions/logger");
const moment = require("moment-timezone");
const app_1 = require("firebase-admin/app");
const storage_1 = require("firebase-admin/storage");
const database_1 = require("firebase-admin/database");
const params_1 = require("firebase-functions/params");
const axios_1 = require("axios");
//const { defineSecret } = require('firebase-functions/params');
const node_abort_controller_1 = require("node-abort-controller");
const qs = require('qs');
//require('./../tk.json');
const serviceAccount = require('./ucl-pms-project-firebase-c6b10789f613.json');
const channelAccessToken = (0, params_1.defineString)("LINE_CHANNEL_ACCESS_TOKEN");
const UIpathAppID = (0, params_1.defineString)("UIPATH_APP_ID");
const UIpathAppSecret = (0, params_1.defineString)("UIPATH_APP_SECRET");
const UIpathCloudTenantAddress = (0, params_1.defineString)("UIPATH_CLOUD_TENANT_ADDRESS");
const express = require('express');

const app = express();
const port = 3000;
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

(0, app_1.initializeApp)({
    credential: (0, app_1.cert)(serviceAccount),
    storageBucket: params_1.storageBucket.value(),
    databaseURL: params_1.databaseURL.value()
});
const lineEventRef = "line_events";
const ImageEventPerformerName = "ImageEvents";
const CallUipathAPIEventPerformerName = "UiPathEvents";
const bucket = (0, storage_1.getStorage)().bucket();
const ServerInstanceDatabase = (0, database_1.getDatabase)().ref("/" + Date.now().toString());
const LineEventsLogStorage = ServerInstanceDatabase.child(lineEventRef);
const PerformerCaches = ServerInstanceDatabase.child("PerformerCaches");
const AuthRequireTrigger = ServerInstanceDatabase.child("AuthRequireTrigger");
const LineTransactionQueue = ServerInstanceDatabase.child("ImageTransactions");
const authenticationStorage = ServerInstanceDatabase.child('Authentication');
const ReplyMessagesQueues = ServerInstanceDatabase.child('ReplyMessages');
const TextMessagesHistory = ServerInstanceDatabase.child('TextMessagesHistory');
const CallUipathAPITransactionQueue = ServerInstanceDatabase.child('UiPathAPITransactions');
const transactionState = { new: "new", process: "process", failed: "failed", successful: "successful", pending: "pending" };
const getRealtimeDatabase = (storage, key, trace) => {
    console.log(`start getRealtimeDatabase(key:${key},trace:${trace}): ${moment().tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm.ss")}`);
    return new Promise((resolve, reject) => {
        storage.child(`${key}/${trace}`).once('value', async (snapshot) => {
            resolve(snapshot.val());
        }, (errorObject) => {
            console.log('The data read failed: ' + errorObject.name);
            reject(new Error('The data read failed: ' + errorObject.name));
        });
    });
};
const setRealtimeDatabase = async (storage, data, key, trace) => {
    //console.log(`start setRealtimeDatabase(trace:${trace},data:${data.toString()|data}): ${moment().tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm.ss")}`)
    const useRef = storage.child(`${key}/${trace}`);
    useRef.set(data, (err) => {
        if (err) {
            console.log(`set ${trace} Error: ${err}`);
            return Promise.reject(err);
        }
        else
            return Promise.resolve();
    });
};
const getLineImage = async (message, messageName, save_date) => {
    console.log("start getLineImage():" + moment().tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm.ss"));
    const controller = new node_abort_controller_1.AbortController(); // สร้าง AbortController
    const signal = controller.signal;
    let lineResponse;
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
            lineResponse = await (0, axios_1.default)({
                url: `https://api-data.line.me/v2/bot/message/${message.id}/content`,
                method: 'GET',
                headers: header,
                responseType: 'arraybuffer',
                //timeout: 5000,
                signal: signal
            });
        }
        catch (err) {
            if (axios_1.default.isCancel(err)) {
                console.log('Request canceled due to timeout');
            }
            else if (err.name === 'AbortError') {
                console.log('Request aborted');
            }
            else {
                console.log("Get Image from Line content failure:" + err.message || err);
            }
            throw new Error(`Get Image from Line content failure: ${err.message || err}`);
        }
        finally {
            clearTimeout(timer); // ยกเลิกตัวจับเวลาถ้าคำขอสำเร็จหรือถูกยกเลิก
        }
        // Convert response data directly to Buffer
        if (lineResponse) {
            try {
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
            }
            catch (err) {
                console.log("Save Image from Line content failure:" + err.message || err);
                throw new Error(`Save Image from Line content failure: ${err.message || err}`);
            }
        }
        else {
            console.log("Unknown Image Response.");
            throw new Error(`Unknown Image Response.`);
        }
    }
    else {
        throw new Error(`The Image is provided by external location.`);
    }
};
const getAndSaveLineImage = async (logKey, message, save_date) => {
    var _a, _b;
    console.log(`start getAndSaveLineImage(): ${moment().tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm:ss")}`);
    const image_name = `${message.id}${((_a = message.imageSet) === null || _a === void 0 ? void 0 : _a.index) != undefined ? 'i' + ((_b = message.imageSet) === null || _b === void 0 ? void 0 : _b.index) : '1'}_${Date.now().toString()}`;
    const saveImageInfo = await getLineImage(message, image_name, save_date);
    return saveImageInfo;
};
const AddUiPathQueueItem = async (itemData) => {
    console.log("start AddQueueItem():" + moment().tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm.ss"));
    const uiPathAuth = await getRealtimeDatabase(PerformerCaches, CallUipathAPIEventPerformerName, "auth");
    const folder_info = uiPathAuth.folderInfo;
    const queue_detail = {
        "itemData": itemData
    };
    //console.log("queue detail:" + JSON.stringify(queue_detail));
    await (0, axios_1.default)({
        url: UIpathCloudTenantAddress.value().trim().replace(/\/$/, "") + "/orchestrator_/odata/Queues/UiPathODataSvc.AddQueueItem",
        method: "POST",
        headers: { "Authorization": `${uiPathAuth.token_type} ${uiPathAuth.access_token}`, "X-UIPATH-OrganizationUnitId": folder_info.Id, "accept": "application/json", "Content-Type": "application/json;odata.metadata=minimal;odata.streaming=true" },
        data: JSON.stringify(queue_detail),
        //timeout: 15000
    }).catch((err) => {
        throw new Error(err.message) || err;
    });
};
const DefaultImageEventPerformerCache = { runningTrace: 0, maxTrace: 1, pendingTrace: 0 };
LineTransactionQueue.orderByChild("state").equalTo(transactionState.new).on('child_added', async (snapshot_queue) => {
    if (!snapshot_queue.exists())
        return;
    if (snapshot_queue.key == null)
        return;
    const snapshot_queueKey = snapshot_queue.key;
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
            console.log("Transaction failed: " + error.message, error);
        }
        else if (!committed) {
            //console.log("Transaction not committed. Queue moved to pending.");
            const snapshot_queueData = snapshot_queue.val();
            snapshot_queueData.state = transactionState.pending;
            LineTransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
        }
        else {
            //console.log("Transaction committed successfully.");
            const snapshot_queueData = snapshot_queue.val();
            snapshot_queueData.state = transactionState.process;
            LineTransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
        }
    });
});
LineTransactionQueue.orderByChild("state").equalTo(transactionState.process).on('child_added', async (snapshot_queue) => {
    if (!snapshot_queue.exists())
        return;
    if (snapshot_queue.key == null)
        return;
    const snapshot_queueKey = snapshot_queue.key;
    console.log("process image: " + snapshot_queueKey);
    let snapshot_queueData = snapshot_queue.val();
    try {
        const line_event = await getRealtimeDatabase(LineEventsLogStorage, snapshot_queueData.eventID, '');
        if (line_event == undefined) {
            console.log("line_events log not found.");
            throw new Error("line_events log not found.");
        }
        const saveImageInfo = await getAndSaveLineImage(snapshot_queueData.eventID, line_event.event.message, snapshot_queueData.date);
        //const event =await getRealtimeDatabase(LineEventsLogStorage,newCallUipathAPIQueue.eventID,"event");
        if (saveImageInfo != undefined) {
            await setRealtimeDatabase(LineEventsLogStorage, 'true', snapshot_queueData.eventID, 'getImg');
            await setRealtimeDatabase(LineEventsLogStorage, saveImageInfo, snapshot_queueData.eventID, 'saveImgPath');
        }
        snapshot_queueData.state = transactionState.successful;
        snapshot_queueData.output = saveImageInfo;
        LineTransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
    }
    catch (err) {
        snapshot_queueData.state = transactionState.failed;
        snapshot_queueData.output = err.message || err;
        LineTransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
    }
});
LineTransactionQueue.orderByChild("state").equalTo(transactionState.failed).on('child_added', async (snapshot_queue) => {
    if (!snapshot_queue.exists())
        return;
    if (snapshot_queue.key == null)
        return;
    const snapshot_queueKey = snapshot_queue.key;
    console.log("retry image: " + snapshot_queueKey);
    let snapshot_queueData = snapshot_queue.val();
    PerformerCaches.child(ImageEventPerformerName).transaction((currentCache) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            return;
        }
        currentCache.runningTrace--;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message, error);
        }
        else {
            if (committed && snapshot_queueData.retriesCount < 3) {
                snapshot_queueData.state = transactionState.new;
                snapshot_queueData.retriesCount++;
                snapshot_queueData.timeStamp = Date.now();
                setTimeout(() => LineTransactionQueue.child(snapshot_queueKey).update(snapshot_queueData), 1000);
            }
        }
    });
});
LineTransactionQueue.orderByChild("state").equalTo(transactionState.successful).on('child_added', async (snapshot_queue) => {
    if (!snapshot_queue.exists())
        return;
    if (snapshot_queue.key == null)
        return;
    const snapshot_queueKey = snapshot_queue.key;
    console.log("successful image: " + snapshot_queueKey);
    const newCallUipathAPIQueue = snapshot_queue.val();
    newCallUipathAPIQueue.state = transactionState.new;
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
            console.log("Transaction failed: " + error.message, error);
        }
    });
});
LineTransactionQueue.orderByChild("state").equalTo(transactionState.pending).on('child_added', async (snapshot_queue) => {
    PerformerCaches.child(ImageEventPerformerName).transaction((currentCache) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            currentCache = DefaultImageEventPerformerCache;
        }
        currentCache.pendingTrace++;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message, error);
        }
    });
});
LineTransactionQueue.orderByChild("state").equalTo(transactionState.pending).on('child_removed', async (snapshot_queue) => {
    PerformerCaches.child(ImageEventPerformerName).transaction((currentCache) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            currentCache = DefaultImageEventPerformerCache;
        }
        if (currentCache.pendingTrace - 1 >= 0)
            currentCache.pendingTrace--;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message, error);
        }
    });
});
var triggerLineEventPending = false;
PerformerCaches.child(ImageEventPerformerName).on('value', (snapshot_performerCache) => {
    const performerCache = snapshot_performerCache.val();
    if (!performerCache)
        return;
    const currentRunningTrace = performerCache.runningTrace;
    const maxRunningTrace = performerCache.maxTrace;
    console.log("ImageEventPerformerName Trigger");
    if (currentRunningTrace < maxRunningTrace) {
        // ดึง queue ที่อยู่ในสถานะ pending
        if (triggerLineEventPending)
            return;
        triggerLineEventPending = true;
        setTimeout(() => {
            triggerLineEventPending = false;
        }, 1000);
        LineTransactionQueue.orderByChild("state").equalTo(transactionState.pending).once('value', async (snapshot_pending) => {
            if (!snapshot_pending.exists())
                return;
            const updates = {};
            let count = maxRunningTrace - currentRunningTrace; // จำนวน queue ที่สามารถนำกลับมาเป็น new ได้
            snapshot_pending.forEach((childSnapshot) => {
                if (count <= 0)
                    return; // หยุดเมื่อ trace เต็ม
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
            triggerLineEventPending = false;
        });
    }
});
var getAuthenticationProcessRunning = false;
//PerformerCaches.child(CallUipathAPIEventPerformerName):{runningTrace:number,maxTrace:number,auth?:uipathToken|null}
const reauth = async () => {
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
    if (getAuthenticationProcessRunning)
        return;
    setTimeout(() => getAuthenticationProcessRunning = false, 5000);
    getAuthenticationProcessRunning = true;
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
    const response = await (0, axios_1.default)({ url, method, headers, data, timeout: 15000 });
    if (response.data) {
        response.data.expires_time = moment().tz('Asia/Bangkok').add(moment.duration(response.data.expires_in - 60, 'seconds')).format('YYYYMMDDHHmmssSSS');
        const accessToken = `${response.data.token_type} ${response.data.access_token}`;
        const MainURL = UIpathCloudTenantAddress.value().trim().replace(/\/$/, "") + "/orchestrator_/odata/Folders";
        const filter_properties = "FullyQualifiedName";
        const compare_value = "Non Production/Meter_Record";
        const folderInfoResponse = await (0, axios_1.default)({
            url: `${MainURL}?%24filter=${filter_properties}%20eq%20%27${compare_value}%27`,
            method: "GET",
            headers: { 'accept': 'application/json', 'Authorization': accessToken },
            timeout: 15000
        });
        if (folderInfoResponse.data) {
            if (parseInt(folderInfoResponse.data["@odata.count"]) > 0) {
                const folder_info = folderInfoResponse.data.value[0];
                response.data.folderInfo = folder_info;
                //console.log(response.data);
                await PerformerCaches.child(CallUipathAPIEventPerformerName + "/auth").set(response.data, (err) => { if (err)
                    console.log("Could not set auth data." + err.message || err); });
                getAuthenticationProcessRunning = false;
                return;
                //.then(()=>{
                //PerformerCaches.child(CallUipathAPIEventPerformerName+"Static").update({GettingToken:false},(err)=>console.log("Could not update CallUipathAPIEventPerformerNameStatic/GettingToken"+err?.message||err))
                //});
            }
        }
        else
            console.log("Unknown folderInfoResponse.", folderInfoResponse);
    }
    else
        console.log("Unknown response.", response);
};
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
const DefaultCallUipathAPIEventPerformerCache = { runningTrace: 0, maxTrace: 1, pendingTrace: 0 };
CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.new).on('child_added', async (snapshot_queue) => {
    if (!snapshot_queue.exists())
        return;
    if (snapshot_queue.key == null)
        return;
    const snapshot_queueKey = snapshot_queue.key;
    console.log("New CallUipathAPI: " + snapshot_queueKey);
    PerformerCaches.child(CallUipathAPIEventPerformerName).transaction((currentCache) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            currentCache = DefaultCallUipathAPIEventPerformerCache;
        }
        // ตรวจสอบว่า currentRunningTrace < maxRunningTrace หรือไม่
        if (currentCache.runningTrace < currentCache.maxTrace && currentCache.auth != undefined) {
            const auth = currentCache.auth;
            if (isTokenExpired(auth)) {
                //currentCache.auth = null;
                return;
            }
            else {
                currentCache.runningTrace++;
                return currentCache;
            }
        }
        return;
    }, async (error, committed, snapshot_newCache) => {
        if (error) {
            console.log("Transaction failed: " + error.message, error);
        }
        else if (!committed) {
            //console.log("Transaction not committed. Queue moved to pending.");
            const snapshot_queueData = snapshot_queue.val();
            snapshot_queueData.state = transactionState.pending;
            snapshot_queueData.output = "RunningTrace full or Authentication token not valid";
            await CallUipathAPITransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
        }
        else if (committed) {
            //logger.log("snapshot"+JSON.stringify( snapshot_newCache?.val()));
            if (snapshot_newCache === null || snapshot_newCache === void 0 ? void 0 : snapshot_newCache.exists()) {
                const newCache = snapshot_newCache.val();
                const snapshot_queueData = snapshot_queue.val();
                snapshot_queueData.state = newCache.auth ? transactionState.process : transactionState.pending;
                await CallUipathAPITransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
            }
            else
                console.log("commited without snapshot_newCache");
        }
    });
});
CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.process).on('child_added', async (snapshot_queue) => {
    if (!snapshot_queue.exists())
        return;
    if (snapshot_queue.key == null)
        return;
    const snapshot_queueKey = snapshot_queue.key;
    console.log("process CallUipathAPI: " + snapshot_queueKey);
    let snapshot_queueData = snapshot_queue.val();
    try {
        const line_event = await getRealtimeDatabase(LineEventsLogStorage, snapshot_queueData.eventID, 'event');
        if (line_event == undefined) {
            console.log("line_events log not found.");
            throw new Error("line_events log not found.");
        }
        ///////////////////
        let saveImageInfo = await getRealtimeDatabase(LineEventsLogStorage, snapshot_queueData.eventID, "saveImgPath");
        if (saveImageInfo != undefined) {
            //setRealtimeDatabase(LineEventsLogStorage, 'true', snapshot_queueData.eventID, 'getImg');
            //setRealtimeDatabase(LineEventsLogStorage, saveImageInfo, snapshot_queueData.eventID, 'saveImgPath');
            const content = {
                "LineEvent": JSON.stringify(line_event),
                "StorageBucket": params_1.storageBucket.value(),
                "PublicImageURL": saveImageInfo.publicURL,
                "ImagePath": saveImageInfo.filePath,
                "LogURL": params_1.databaseURL.value() + "/" + lineEventRef + "/" + snapshot_queueData.eventID, "CreateDate": snapshot_queueData.date + " " + snapshot_queueData.time
            };
            const queue_detail = {
                "Name": "UnrecognizedImages",
                "Priority": "Normal",
                "Reference": snapshot_queueData.eventID,
                "SpecificContent": content
            };
            await AddUiPathQueueItem(queue_detail);
        }
        else {
            throw new Error("saveImageInfo not found.");
        }
        ///////////////////
        //const saveImageInfo = "test"//await getAndSaveLineImage(snapshot_queueData.eventID,line_event.event.message,snapshot_queueData.date);
        snapshot_queueData.state = transactionState.successful;
        CallUipathAPITransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
    }
    catch (err) {
        snapshot_queueData.state = transactionState.failed;
        snapshot_queueData.output = err.message || err;
        CallUipathAPITransactionQueue.child(snapshot_queueKey).update(snapshot_queueData);
    }
});
CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.failed).on('child_added', async (snapshot_queue) => {
    if (!snapshot_queue.exists())
        return;
    if (snapshot_queue.key == null)
        return;
    const snapshot_queueKey = snapshot_queue.key;
    console.log("retry CallUipathAPI: " + snapshot_queueKey);
    let snapshot_queueData = snapshot_queue.val();
    PerformerCaches.child(CallUipathAPIEventPerformerName).transaction((currentCache) => {
        if (!currentCache) {
            return;
        }
        currentCache.runningTrace--;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message, error);
        }
        else {
            if (committed && snapshot_queueData.retriesCount < 3) {
                snapshot_queueData.state = transactionState.new;
                snapshot_queueData.retriesCount++;
                snapshot_queueData.timeStamp = Date.now();
                setTimeout(() => CallUipathAPITransactionQueue.child(snapshot_queueKey).update(snapshot_queueData), 1000);
            }
        }
    });
});
CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.successful).on('child_added', async (snapshot_queue) => {
    if (!snapshot_queue.exists())
        return;
    if (snapshot_queue.key == null)
        return;
    const snapshot_queueKey = snapshot_queue.key;
    console.log("successful CallUipathAPI: " + snapshot_queueKey);
    PerformerCaches.child(CallUipathAPIEventPerformerName).transaction((currentCache) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            return;
        }
        currentCache.runningTrace--;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message, error);
        }
    });
});
CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.pending).on('child_added', async (snapshot_queue) => {
    PerformerCaches.child(CallUipathAPIEventPerformerName).transaction((currentCache) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            currentCache = DefaultCallUipathAPIEventPerformerCache;
        }
        currentCache.pendingTrace++;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message, error);
        }
    });
});
CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.pending).on('child_removed', async (snapshot_queue) => {
    PerformerCaches.child(CallUipathAPIEventPerformerName).transaction((currentCache) => {
        if (!currentCache) {
            // กรณีที่ไม่มีข้อมูล performerCache ให้ตั้งค่าดีฟอลต์
            currentCache = DefaultCallUipathAPIEventPerformerCache;
        }
        if (currentCache.pendingTrace - 1 >= 0)
            currentCache.pendingTrace--;
        return currentCache;
    }, async (error, committed, snapshot) => {
        if (error) {
            console.log("Transaction failed: " + error.message, error);
        }
    });
});
const isTokenExpired = (auth) => {
    if (!auth)
        return false;
    if (!auth.exprires_time)
        return false;
    const tokenExpiresMoment = moment(auth.exprires_time, 'YYYYMMDDHHmmssSSS').tz('Asia/Bangkok');
    const isTokenExpired = moment().tz('Asia/Bangkok').isAfter(tokenExpiresMoment);
    return isTokenExpired;
};
var triggerCallAPIPending = false;
PerformerCaches.child(CallUipathAPIEventPerformerName).on('value', (snapshot_performerCache) => {
    //Trigger: New.added #transaction=>runningTrace.changed, Successful.added #transaction=>runningTrace.changed, Failed.added #transaction=>runningTrace.changed
    const performerCache = snapshot_performerCache.val();
    if (!performerCache)
        return;
    const currentRunningTrace = performerCache.runningTrace || 1;
    const maxRunningTrace = performerCache.maxTrace || 1;
    const auth = performerCache.auth;
    if (currentRunningTrace < maxRunningTrace && auth != undefined) {
        if (isTokenExpired(auth)) {
            reauth();
            return;
        }
        // ดึง queue ที่อยู่ในสถานะ pending
        else {
            if (triggerCallAPIPending)
                return;
            triggerCallAPIPending = true;
            setTimeout(() => {
                triggerCallAPIPending = false;
            }, 1000);
            CallUipathAPITransactionQueue.orderByChild("state").equalTo(transactionState.pending).once('value', async (snapshot_pending) => {
                if (!snapshot_pending.exists())
                    return;
                const updates = {};
                let count = maxRunningTrace - currentRunningTrace; // จำนวน queue ที่สามารถนำกลับมาเป็น new ได้
                snapshot_pending.forEach((childSnapshot) => {
                    if (count <= 0)
                        return; // หยุดเมื่อ trace เต็ม
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
                triggerCallAPIPending = false;
            });
        }
    }
    else if (auth == undefined) {
        reauth();
    }
});
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//# sourceMappingURL=index.js.map
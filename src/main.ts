import {storageBucket,databaseURL, app, database,PerformerCaches, transactionState ,ServerInstanceDatabase,Listener_NewTransaction, Listener_PrecessTransaction, Listener_FinalizeTransaction, Listener_FailedTransaction, Listener_PendingTransaction} from './template';
import moment from 'moment-timezone';
import { getStorage } from 'firebase-admin/storage';
import { Reference ,DataSnapshot } from "firebase-admin/database";
import { Bucket} from '@google-cloud/storage';
import {
    SaveImageInfo,
    UnrecognizedImagesContent,
    ImageMessage,
    Folder,
    QueueItemDataDto,
    EventTransactionInfo,
} from './type';
import axios from 'axios';
import {AxiosResponse} from 'axios';
import { AbortController } from 'node-abort-controller';
import * as fs from 'fs';
import * as path from 'path';
import * as qs from 'qs';

const token = {
    LINE_CHANNEL_ACCESS_TOKEN:process.env.LINE_CHANNEL_ACCESS_TOKEN!,
    UIPATH_APP_ID:process.env.UIPATH_APP_ID!,
    UIPATH_APP_SECRET:process.env.UIPATH_APP_SECRET!,
    UIPATH_CLOUD_TENANT_ADDRESS:process.env.UIPATH_CLOUD_TENANT_ADDRESS!,
    UIPATH_SCOPE:process.env.UIPATH_SCOPE!,
    LINE_CHANNEL_SECRET:process.env.LINE_CHANNEL_SECRET!
};
const channelAccessToken= token.LINE_CHANNEL_ACCESS_TOKEN//: StringParam = defineString("LINE_CHANNEL_ACCESS_TOKEN");
const UIpathAppID=token.UIPATH_APP_ID//: StringParam = defineString("UIPATH_APP_ID");
const UIpathAppSecret=token.UIPATH_APP_SECRET//: StringParam = defineString("UIPATH_APP_SECRET");
const UIpathCloudTenantAddress=token.UIPATH_CLOUD_TENANT_ADDRESS//: StringParam = defineString("UIPATH_CLOUD_TENANT_ADDRESS");
const UipathScope = token.UIPATH_SCOPE

const lineEventRef = "line_events";
const ImageEventPerformerName = "ImageEvents";
const CallUipathAPIEventPerformerName = "UiPathEvents";
const strPerformerCaches = "PerformerCaches";
const strImageTransactions = "ImageTransactions";
const strUiPathAPITransactions = "UiPathAPITransactions";
const strLocalConfigs = "LocalConfigs";
const strlocalImagePath = "localImagePath";
const strsaveImageOnLocal = "saveImageOnLocal";
const strUiPathFolder_MeterRecord = "UiPathFolder_MeterRecord";
const strUiPathFolder_ERPSync = "UiPathFolder_ERPSync";
const strQueueName_MeterRecord = "QueueName_MeterRecord";
const strQueueName_ERPSync = "QueueName_ERPSync";
const bucket: Bucket = getStorage().bucket();
const LineEventsLogStorage: Reference = ServerInstanceDatabase.child(lineEventRef);
const ServerHealth: Reference = ServerInstanceDatabase.child("ServerHealth");
const LocalConfigs: Reference = ServerInstanceDatabase.child(strLocalConfigs);
const LineTransactionQueue: Reference = ServerInstanceDatabase.child(strImageTransactions);
const CallUipathAPITransactionQueue: Reference = ServerInstanceDatabase.child(strUiPathAPITransactions);


type performerCache = {runningTrace:number,maxTrace:number,auth?:uipathToken|null,pendingTrace:pendingTrace}
type pendingTrace = {total:number,traceIDs?:traceIDs}
type traceIDs = {first:string,last:string,data:pendingTracesData}
type pendingTracesData = {[key:string]:{timestamp:number,next?:string}}
type uipathToken = {access_token:string,expires_in:number,expired_time:string,scope:string,token_type:string,folderInfo?:any,requireToken?:true}

//default configs
const DefaultImageEventPerformerCache:performerCache = {runningTrace: 0, maxTrace: 15,pendingTrace:{total:0}}
const DefaultCallUipathAPIEventPerformerCache:performerCache =  {runningTrace:0,maxTrace:15,pendingTrace:{total:0}}
const DefaultUiPathFolder_MeterRecord = "Non Production/Meter_Record";
const DefaultUiPathFalder_ERPSync = "Non Production/ERP_Sync";
const DefaultlocalImagePath = "C:\\";
const DefaultsaveImageOnLocal = false;
const DefaultQueueName_MeterRecord = "UnrecognizedImages";
const DefaultQueueName_ERPSync = "ERPSync";

//running flags
let IsInit = false;
const getAuthenticationProcessRunning:{running:boolean} = {running:false};

PerformerCaches.child(ImageEventPerformerName+"/maxTrace").on('value',(snapshot)=>{
    if(snapshot.exists())DefaultImageEventPerformerCache.maxTrace = snapshot.val();
})
PerformerCaches.child(CallUipathAPIEventPerformerName+"/maxTrace").on('value',(snapshot)=>{
    if(snapshot.exists())DefaultCallUipathAPIEventPerformerCache.maxTrace = snapshot.val();
})
PerformerCaches.child(ImageEventPerformerName).on('child_removed',(snapshot)=>{
    PerformerCaches.child(ImageEventPerformerName).set(DefaultImageEventPerformerCache);
})
PerformerCaches.child(CallUipathAPIEventPerformerName).on('child_removed',(snapshot)=>{
    PerformerCaches.child(CallUipathAPIEventPerformerName).set(DefaultCallUipathAPIEventPerformerCache);
})
LocalConfigs.child(strUiPathFolder_MeterRecord).on('child_changed',(snapshot)=>{
    PerformerCaches.child(CallUipathAPIEventPerformerName).set(DefaultCallUipathAPIEventPerformerCache);
})

ServerHealth.child("lastActive").on('value',(DataSnapshot:DataSnapshot)=>{
    ServerHealth.child("lastActive").set(moment().tz('Asia/Bangkok').format("YYYY-MM-DD HH:mm:ss"));
    setTimeout(() => {
        //setRealtimeDatabase(ServerHealth,moment().tz('Asia/Bangkok').add(moment.duration(60, 'seconds')).format("YYYY-MM-DD HH:mm:ss.SSS"),"lastActive","");
        ServerHealth.child("lastActive").set(moment().tz('Asia/Bangkok').format("YYYY-MM-DD HH:mm:ss"));
    }, 60000);
})

const initServer = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        ServerInstanceDatabase.once('value', async (currentCacheSnapshot) => {
            try {
                let currentCache = currentCacheSnapshot.val();
                console.log(".");

                if (!currentCache) {
                    currentCache ={};
                    //await ServerInstanceDatabase.set(newValue);
                    //IsInit = true;
                    //resolve(); // Resolve Promise หลังจากตั้งค่าเสร็จ
                    //return;
                }
                currentCache[strPerformerCaches] =
                    {
                        [ImageEventPerformerName]: DefaultImageEventPerformerCache,
                        [CallUipathAPIEventPerformerName]: DefaultCallUipathAPIEventPerformerCache
                    };
                if(currentCache[strLocalConfigs]===undefined || currentCache[strLocalConfigs]===null){
                    currentCache[strLocalConfigs] = {};
                }
                if(currentCache[strLocalConfigs][strlocalImagePath]===undefined){
                    currentCache[strLocalConfigs][strlocalImagePath] = DefaultlocalImagePath;
                }
                if(currentCache[strLocalConfigs][strsaveImageOnLocal]===undefined){
                    currentCache[strLocalConfigs][strsaveImageOnLocal] = DefaultsaveImageOnLocal;
                }
                if(currentCache[strLocalConfigs][strUiPathFolder_MeterRecord]===undefined){
                    currentCache[strLocalConfigs][strUiPathFolder_MeterRecord] = DefaultUiPathFolder_MeterRecord;
                }
                if(currentCache[strLocalConfigs][strUiPathFolder_ERPSync]===undefined){
                    currentCache[strLocalConfigs][strUiPathFolder_ERPSync] = DefaultUiPathFalder_ERPSync;
                }
                if(currentCache[strLocalConfigs][strQueueName_MeterRecord]===undefined){
                    currentCache[strLocalConfigs][strQueueName_MeterRecord] = DefaultQueueName_MeterRecord;
                }
                if(currentCache[strLocalConfigs][strQueueName_ERPSync]===undefined){
                    currentCache[strLocalConfigs][strQueueName_ERPSync] = DefaultQueueName_ERPSync;
                }
                
                if (currentCache[strImageTransactions]) {
                    const imageTransaction = { ...currentCache[strImageTransactions] };
                    Object.keys(imageTransaction).forEach(childKey => {
                        if (imageTransaction[childKey].state !== transactionState.successful) {
                            imageTransaction[childKey].state = transactionState.takeover;
                        }
                    });
                    currentCache[strImageTransactions] = imageTransaction;
                }

                if (currentCache[strUiPathAPITransactions]) {
                    const uipathTransaction = { ...currentCache[strUiPathAPITransactions] };
                    Object.keys(uipathTransaction).forEach(childKey => {
                        if (uipathTransaction[childKey].state !== transactionState.successful) {
                            uipathTransaction[childKey].state = transactionState.takeover;
                        }
                    });
                    currentCache[strUiPathAPITransactions] = uipathTransaction;
                }

                const updateCache = {
                    [ImageEventPerformerName]: DefaultImageEventPerformerCache,
                    [CallUipathAPIEventPerformerName]: DefaultCallUipathAPIEventPerformerCache
                };
                currentCache[strPerformerCaches] = updateCache;
                
                await ServerInstanceDatabase.set(currentCache);
                IsInit = true;
                resolve(); // Resolve Promise เมื่อการตั้งค่าทั้งหมดเสร็จสมบูรณ์
            } catch (error) {
                console.error("Error initializing server:", error);
                reject(error); // Reject Promise หากเกิดข้อผิดพลาด
            }
        });
    });
};

const startServer = async () => {
    try {
        await initServer(); // รอให้ initserver ทำงานเสร็จ
        console.log("Server Start");
        IsInit = true;
        //image event
        Listener_NewTransaction(IsInit,LineTransactionQueue,ImageEventPerformerName,DefaultImageEventPerformerCache);
        Listener_PendingTransaction(IsInit,LineTransactionQueue,ImageEventPerformerName,DefaultImageEventPerformerCache);
        Listener_FailedTransaction(IsInit,LineTransactionQueue,ImageEventPerformerName,DefaultImageEventPerformerCache);
        Listener_FinalizeTransaction(IsInit,LineTransactionQueue,ImageEventPerformerName,DefaultImageEventPerformerCache,async (snapshot_queueKey:string,snapshot_queueData:EventTransactionInfo)=>{
            const newCallUipathAPIQueue:EventTransactionInfo = {...snapshot_queueData,type:DefaultQueueName_MeterRecord};
            newCallUipathAPIQueue.state = transactionState.new;
            newCallUipathAPIQueue.retriesCount = 0;
            CallUipathAPITransactionQueue.push(newCallUipathAPIQueue);
        });
        Listener_PrecessTransaction(IsInit,LineTransactionQueue,ImageEventPerformerName,async (snapshot_queueKey:string,snapshot_queueData:EventTransactionInfo)=>{
            const line_event = await getRealtimeDatabase(LineEventsLogStorage,snapshot_queueData.eventID,'');
            if(line_event == undefined){
                console.log("line_events log not found.");
                throw new Error("line_events log not found.");
            }
            const saveImageInfo = await getAndSaveLineImage(snapshot_queueData.eventID,line_event.event.message,snapshot_queueData.date);
            //const event =await getRealtimeDatabase(LineEventsLogStorage,newCallUipathAPIQueue.eventID,"event");
            if (saveImageInfo != undefined) {
                await setRealtimeDatabase(LineEventsLogStorage, 'true', snapshot_queueData.eventID, 'getImg');
                await setRealtimeDatabase(LineEventsLogStorage, saveImageInfo, snapshot_queueData.eventID, 'saveImgPath');
            }
            return saveImageInfo;
        })


        //uipath event
        Listener_NewTransaction(IsInit,CallUipathAPITransactionQueue,CallUipathAPIEventPerformerName,DefaultCallUipathAPIEventPerformerCache,async (snapshot_queueKey:string,snapshot_queueData:EventTransactionInfo)=>{
            const Cache = await PerformerCaches.child(CallUipathAPIEventPerformerName).once('value');
            if(Cache.val()){
                const CacheValues:performerCache = Cache.val()
                if(CacheValues.auth){
                    if(!isTokenExpired(CacheValues.auth)){
                        //console.log("valid")
                        return "valid";
                    }
                    
                }
            }
            //console.log("invalid");
            await reauth();
            return "valid";
        });
        Listener_PendingTransaction(IsInit,CallUipathAPITransactionQueue,CallUipathAPIEventPerformerName,DefaultCallUipathAPIEventPerformerCache);
        Listener_FailedTransaction(IsInit,CallUipathAPITransactionQueue,CallUipathAPIEventPerformerName,DefaultCallUipathAPIEventPerformerCache);
        Listener_FinalizeTransaction(IsInit,CallUipathAPITransactionQueue,CallUipathAPIEventPerformerName,DefaultCallUipathAPIEventPerformerCache);
        Listener_PrecessTransaction(IsInit,CallUipathAPITransactionQueue,CallUipathAPIEventPerformerName,async (snapshot_queueKey:string,snapshot_queueData:EventTransactionInfo)=>{
            if(snapshot_queueData.type===DefaultQueueName_MeterRecord){
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
                    let queueName = await getRealtimeDatabase(LocalConfigs,strQueueName_MeterRecord,"");
                    if(!queueName){ 
                        setRealtimeDatabase(LocalConfigs,DefaultQueueName_MeterRecord,strQueueName_MeterRecord,"");
                        queueName = DefaultQueueName_MeterRecord;
                    }
                    const content: UnrecognizedImagesContent = {
                        "LineEvent": JSON.stringify(line_event), 
                        "StorageBucket": storageBucket.value(), 
                        "PublicImageURL": saveImageInfo.publicURL, 
                        "ImagePath": saveImageInfo.filePath, 
                        "LogURL": databaseURL.value() + "/" +lineEventRef + "/" + snapshot_queueData.eventID, "CreateDate": snapshot_queueData.date + " " + snapshot_queueData.time 
                    };
                    const queue_detail: QueueItemDataDto = {
                        "Name": queueName,
                        "Priority": "Normal",
                        "Reference": snapshot_queueData.eventID,
                        "SpecificContent": content
                    }
                    const uiPathAuth: uipathToken = await getRealtimeDatabase(PerformerCaches,CallUipathAPIEventPerformerName,"auth");
                    const folder_info: Folder = uiPathAuth.folderInfo[strUiPathFolder_MeterRecord];
                    if(typeof folder_info === "string" || folder_info === null || folder_info === undefined){
                        throw new Error("Folder info error: "+folder_info||"null");
                    }else{
                        await AddUiPathQueueItem(queue_detail,`${uiPathAuth.token_type} ${uiPathAuth.access_token}`,folder_info.Id);
                    }
                }else{
                    throw new Error("saveImageInfo not found.");
                }
            }else if(snapshot_queueData.type===DefaultQueueName_ERPSync){
                //ERP Sync Queue process here
                let queueName = await getRealtimeDatabase(LocalConfigs,strQueueName_ERPSync,"");
                if(!queueName){ 
                    setRealtimeDatabase(LocalConfigs,DefaultQueueName_ERPSync,strQueueName_ERPSync,"");
                    queueName = DefaultQueueName_ERPSync;
                }
                
                const content: any = {
                    ...snapshot_queueData.parameters
                };
                const queue_detail: QueueItemDataDto = {
                    "Name": queueName,
                    "Priority": "Normal",
                    "Reference": snapshot_queueData.eventID,
                    "SpecificContent": content
                }
                const uiPathAuth: uipathToken = await getRealtimeDatabase(PerformerCaches,CallUipathAPIEventPerformerName,"auth");
                const folder_info: Folder = uiPathAuth.folderInfo[strUiPathFolder_ERPSync];
                if(typeof folder_info === "string" || folder_info === null || folder_info === undefined){
                    throw new Error("Folder info error: "+folder_info||"null");
                }else{
                    await AddUiPathQueueItem(queue_detail,`${uiPathAuth.token_type} ${uiPathAuth.access_token}`,folder_info.Id);
                }
            }
            else{
                throw new Error("Unknown Queue Type: "+snapshot_queueData.type);
            }
            
        })

    } catch (error) {
        console.error("Failed to initialize server:", error);
    }
};

startServer();

//////////////////////////////////
//////// internal portal /////////
//////////////////////////////////
import express from "express";
import bodyParser from "body-parser";
import crypto from "crypto";

// ใช้ environment variable เพื่อเก็บ token
// เช่นใน Windows environment variable: PORTAL_API_TOKEN=my-secret-token
const AUTH_TOKEN = process.env.PORTAL_API_TOKEN || "change_this_secret_token";
const PORT = process.env.PORTAL_PORT ? Number(process.env.PORTAL_PORT) : 8787;

const appServer = express();
appServer.use(bodyParser.json());
//Middleware สำหรับตรวจสอบ Authorization
appServer.use((req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.split(" ")[1];
  if (token !== AUTH_TOKEN) {
    return res.status(403).json({ error: "Forbidden: invalid token" });
  }

  next(); // ผ่านการตรวจสอบ
});

//Health Check Endpoint
appServer.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString(),
    COMPANY_ID: req.headers["company_id"],
    CONTACT_ID: req.headers["contact_id"],
  });
  console.log("pinged",req.ip);
});

appServer.post("/Sync", async (req, res) => {
  try {
    // ดึงค่า COMPANY_ID จาก header
    const companyId = req.headers["company_id"] || req.headers["COMPANY-ID"];
    const contactId = req.headers["contact_id"] || req.headers["CONTACT-ID"];
    const tableName = req.headers["table_name"] || req.headers["TABLE-NAME"];
    const status = req.headers["status"] || req.headers["STATUS"];
    if (!companyId || !contactId || !tableName || !status) {
      return res.status(400).json({ error: "Missing parameters"});
    }

    // สร้าง eventID แบบ unique
    const eventID = `${crypto.randomUUID()}`;

    // สร้าง object EventTransactionInfo
    const newTransaction: EventTransactionInfo = {
      eventID,
      date: moment().tz("Asia/Bangkok").format("YYYY-MM-DD"),
      time: moment().tz("Asia/Bangkok").format("HH:mm:ss"),
      state: transactionState.new,
      retriesCount: 0,
      timeStamp: Date.now(),
      parameters: { COMPANY_ID: companyId, CONTACT_ID: contactId, TABLE_NAME: tableName, STATUS: status },
      type: "ERPSync",
    };

    // push ลง Firebase
    await CallUipathAPITransactionQueue.push(newTransaction);

    console.log(`[Portal] New ERPSync transaction created: ${eventID}`);

    res.json({ success: true, id: eventID, data: newTransaction });
  } catch (err: any) {
    console.error("[Portal] Error creating transaction:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  }
});

appServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Internal portal listening on http://localhost:${PORT}`);
});

/////////////////
/////modules/////
/////////////////
const isTokenExpired = (auth:uipathToken|undefined)=>{
    if(!auth)return true;
    if(!auth.expired_time)return true;
    const tokenExpiresMoment = moment(auth.expired_time, 'YYYYMMDDHHmmssSSS').tz('Asia/Bangkok');
    const isTokenExpired = moment().tz('Asia/Bangkok').isAfter(tokenExpiresMoment);
    return isTokenExpired;
}

const reauth =async ()=>{
    if(getAuthenticationProcessRunning.running)return;   
    setTimeout(()=>getAuthenticationProcessRunning.running=false,5000);
    getAuthenticationProcessRunning.running=true;
    console.log("re-authentication");
    const clientId = UIpathAppID.trim();
    const clientSecret = UIpathAppSecret.trim().replace(/\\/g, "");
    //console.log(`${clientId} @@ ${UIpathAppSecret} @@ ${clientSecret}`);

    const url = 'https://cloud.uipath.com/identity_/connect/token';
    const method = 'POST';
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const data = qs.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: UipathScope
    });
    
    const response =  await axios({url,method,headers,data,timeout: 15000})
    if(response.data){
        response.data.expired_time = moment().tz('Asia/Bangkok').add(moment.duration(response.data.expires_in - 60, 'seconds')).format('YYYYMMDDHHmmssSSS');
        const accessToken = `${response.data.token_type} ${response.data.access_token}`;

        //get folder info
        const allFolders:{FolderKey:string,Default:string}[] = [{FolderKey:strUiPathFolder_MeterRecord,Default:DefaultUiPathFolder_MeterRecord}
            ,{FolderKey:strUiPathFolder_ERPSync,Default:DefaultUiPathFalder_ERPSync}];
        const MainURL = UIpathCloudTenantAddress.trim().replace(/\/$/, "") + "/orchestrator_/odata/Folders";
        const filter_properties = "FullyQualifiedName";
        const folderInfos:any = {};
        
        await Promise.all(allFolders.map(async (folder)=>{
            const getConfigFolder = await getRealtimeDatabase(LocalConfigs,folder.FolderKey,"");
            const compare_value = getConfigFolder?getConfigFolder:folder.Default;
            if(!getConfigFolder){
                setRealtimeDatabase(LocalConfigs,folder.Default,folder.FolderKey,"");
            }
            const folderInfoResponse = await axios({
                url:`${MainURL}?%24filter=${filter_properties}%20eq%20%27${compare_value}%27`,
                method:"GET",
                headers:{ 'accept': 'application/json', 'Authorization': accessToken},
                timeout: 15000
            })
            if(folderInfoResponse.data){
                if(parseInt(folderInfoResponse.data["@odata.count"])>0){
                    const folder_info = folderInfoResponse.data.value[0];
                    folderInfos[folder.FolderKey] = folder_info;
                }else{
                    console.log(`Folder ${compare_value} not found.`);
                    folderInfos[folder.FolderKey] = "Folder not found";
                }
            }else console.log("Unknown folderInfoResponse.",folderInfoResponse);

        }));

        response.data.folderInfo = folderInfos;
        await PerformerCaches.child(CallUipathAPIEventPerformerName+"/auth").set(response.data,(err)=>{if(err)console.log("Could not set auth data."+err.message||err)});
        const AuthenticatedFinalizeTransaction : EventTransactionInfo = {
                eventID:"UiPathAuth",
                date:"-",
                time:"-",
                state: transactionState.finalize,
                retriesCount:0,
                timeStamp:0,
                type:"UiPathAuth"
            }
        await CallUipathAPITransactionQueue.child("Authenticated").set(AuthenticatedFinalizeTransaction);
        getAuthenticationProcessRunning.running=false;

        return;
    }else console.log("Unknown response.",response);
}

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

const getLineImageToLocalPath = async (message: ImageMessage,messageName: string, save_date: string): Promise<SaveImageInfo> => {
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
        Authorization: 'Bearer ' + channelAccessToken.trim(),
    };
    if (message.contentProvider.type == 'line') {
        try {    
            lineResponse = await axios({
                url: `https://api-data.line.me/v2/bot/message/${message.id}/content`,
                method: 'GET',
                headers: header,
                responseType: 'arraybuffer', // ใช้ arraybuffer แทน blob
                //timeout: 5000,
                signal: signal
            });
        } catch (err:any) {
            if (axios.isCancel(err)) {
                console.log('Request canceled due to timeout');
            } else if (err.name === 'AbortError') {
                console.log('Request aborted');
            } else {
                console.log("Get Image from Line content failure:" + err.message || err);
            }
            throw new Error(`Get Image from Line content failure: ${err.message || err}`);
        } finally {
            clearTimeout(timer); // ยกเลิกตัวจับเวลาถ้าคำขอสำเร็จหรือถูกยกเลิก
        }
        
        // Convert response data directly to Buffer
        if (lineResponse) {
            try {
                const buffer = Buffer.from(lineResponse.data);
                const [mimeType, extension] = lineResponse.headers['content-type'].split('/'); // ใช้ headers แทน data.type
                let LocalPath:string = await getRealtimeDatabase(LocalConfigs,"localImagePath","");
                if(!LocalPath || LocalPath.trim()==""){ setRealtimeDatabase(LocalConfigs,"C:","localImagePath","");}
                const defaultPath:string = "C:"
                // Construct file path
                //const filePath = path.join(__dirname,LocalPath || defaultPath, save_date, `img${messageName}.${extension}`);
                const basePath = path.isAbsolute(LocalPath) ? LocalPath : defaultPath;
                const filePath = path.join(basePath, save_date, `img${messageName}.${extension}`);
        
                // Ensure the directory exists
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
        
                // Save the buffer data to the local file
                fs.writeFileSync(filePath, buffer);
        
                console.log('File saved successfully:', filePath);
                return { publicURL: "localhost", filePath };
            } catch (err:any) {
                console.log("Save Image from Line content failure:" + err.message || err);
                throw new Error(`Save Image from Line content failure: ${err.message || err}`);
            }
        } else {
            console.log("Unknown Image Response.");
            throw new Error(`Unknown Image Response.`);
        }
    } else {
        throw new Error(`The Image is provided by external location.`);
    }
}

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
        Authorization: 'Bearer ' + channelAccessToken.trim(),
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
    const saveMethod= await getRealtimeDatabase(LocalConfigs,"saveImageOnLocal","");
    const image_name = `${message.id}${message.imageSet?.index != undefined ? 'i' + message.imageSet?.index : '1'}_${Date.now().toString()}`;
    if(!saveMethod)setRealtimeDatabase(LocalConfigs,false,"saveImageOnLocal","");

    const saveImageInfo = saveMethod==true? await getLineImageToLocalPath(message, image_name, save_date): await getLineImage(message, image_name, save_date);
    return saveImageInfo;
};

const AddUiPathQueueItem = async (itemData: QueueItemDataDto,authorization:string,folderID:number) => {
    console.log("start AddQueueItem():" + moment().tz("Asia/Bangkok").format("YYYY/MM/DD HH:mm.ss"));
    //const uiPathAuth: uipathToken = await getRealtimeDatabase(PerformerCaches,CallUipathAPIEventPerformerName,"auth");
    //const folder_info: Folder = uiPathAuth.folderInfo.Id;
    const queue_detail: { "itemData": QueueItemDataDto } = {
        "itemData": itemData
    }
    //console.log("queue detail:" + JSON.stringify(queue_detail));
    await axios({
        url:UIpathCloudTenantAddress.trim().replace(/\/$/, "") + "/orchestrator_/odata/Queues/UiPathODataSvc.AddQueueItem",
        method:"POST",
        headers:{ "Authorization": authorization, "X-UIPATH-OrganizationUnitId": folderID, "accept": "application/json", "Content-Type": "application/json;odata.metadata=minimal;odata.streaming=true" },
        data:JSON.stringify(queue_detail),
        //timeout: 15000
    }).catch((err)=>{
        throw new Error(err.message) || err
    })
    
}
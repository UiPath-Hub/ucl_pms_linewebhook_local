import {storageBucket,databaseURL, app, database, transactionState ,ServerInstanceDatabase,Listener_NewTransaction} from './newTemplete';
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
//const ImageEventPerformerName = "ImageEvents";
//const CallUipathAPIEventPerformerName = "UiPathEvents";
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
let LocalUiPathAuth:
    uipathToken | null = null;
let AuthenticationPromise:
    Promise<void> | null = null;

// LocalConfigs cache for improved data availability
let LocalConfigsCache: {[key: string]: any} = {
    [strlocalImagePath]: DefaultlocalImagePath,
    [strsaveImageOnLocal]: DefaultsaveImageOnLocal,
    [strUiPathFolder_MeterRecord]: DefaultUiPathFolder_MeterRecord,
    [strUiPathFolder_ERPSync]: DefaultUiPathFalder_ERPSync,
    [strQueueName_MeterRecord]: DefaultQueueName_MeterRecord,
    [strQueueName_ERPSync]: DefaultQueueName_ERPSync
};

// Real-time listener to keep LocalConfigsCache updated
LocalConfigs.on('value', (snapshot) => {
    if (snapshot.exists()) {
        LocalConfigsCache = { ...LocalConfigsCache, ...snapshot.val() };
        console.log('LocalConfigsCache updated:', LocalConfigsCache);
    }
});

ServerHealth.child("lastActive").on('value',(DataSnapshot:DataSnapshot)=>{
    ServerHealth.child("lastActive").set(moment().tz('Asia/Bangkok').format("YYYY-MM-DD HH:mm:ss"));
    setTimeout(() => {
        //setRealtimeDatabase(ServerHealth,moment().tz('Asia/Bangkok').add(moment.duration(60, 'seconds')).format("YYYY-MM-DD HH:mm:ss.SSS"),"lastActive","");
        ServerHealth.child("lastActive").set(moment().tz('Asia/Bangkok').format("YYYY-MM-DD HH:mm:ss"));
    }, 60000);
})

// Helper function to get LocalConfigs values from cache
const getLocalConfigValue = (key: string, defaultValue: any = null): any => {
    const value = LocalConfigsCache[key];
    return value !== undefined && value !== null ? value : defaultValue;
};

const validateEnvironmentVariables = (): void => {
    const requiredEnvVars = [
        'LINE_CHANNEL_ACCESS_TOKEN',
        'UIPATH_APP_ID',
        'UIPATH_APP_SECRET',
        'UIPATH_CLOUD_TENANT_ADDRESS',
        'UIPATH_SCOPE',
        'LINE_CHANNEL_SECRET',
        'DATABASE_URL',
        'STORAGEBUCKET_URL',
        'SERVER_INSTANCE_DATABASE'
    ];

    const missingVars: string[] = [];
    const invalidVars: string[] = [];

    requiredEnvVars.forEach(varName => {
        const value = process.env[varName];
        if (!value || value.trim() === '') {
            missingVars.push(varName);
        }
    });

    if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    if (invalidVars.length > 0) {
        throw new Error(`Invalid environment variables: ${invalidVars.join(', ')}`);
    }

    console.log('Environment variables validation passed');
};

const initServer = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        try {
            // Validate environment variables before proceeding
            validateEnvironmentVariables();
        } catch (error) {
            reject(error);
            return;
        }

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
        const processLineImageEvent = async (snapshot_queueKey:string,snapshot_queueData:EventTransactionInfo)=>{
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
        };
        const finalizeLineImageEvent = async (snapshot_queueKey:string,snapshot_queueData:EventTransactionInfo)=>{
            const newCallUipathAPIQueue:EventTransactionInfo = {...snapshot_queueData,type:DefaultQueueName_MeterRecord};
            newCallUipathAPIQueue.state = transactionState.new;
            newCallUipathAPIQueue.retriesCount = 0;
            newCallUipathAPIQueue.version = 0;
            newCallUipathAPIQueue.timeStamp = Date.now();
            CallUipathAPITransactionQueue.push(newCallUipathAPIQueue);
        };
        Listener_NewTransaction(IsInit,LineTransactionQueue,DefaultImageEventPerformerCache,undefined,processLineImageEvent,finalizeLineImageEvent);
 

        //uipath event
        const initializeUiPathTransaction =
        async (
            snapshot_queueKey: string,
            snapshot_queueData: EventTransactionInfo
        ): Promise<"valid" | "invalid"> => {
            //already authenticated
            if (LocalUiPathAuth &&!isTokenExpired(LocalUiPathAuth)) {
                return "valid";
            }

            //authentication already running
            if (AuthenticationPromise) {
                await CallUipathAPITransactionQueue
                    .child(snapshot_queueKey)
                    .update({
                        state:transactionState.pending_authentication,
                        pendingReason:"waiting for authentication"
                    });
                return "invalid";
            }
            // perform authentication
            await ensureAuthenticated();
            return "valid";
        };
        const processUiPathEvent =
            async (
                snapshot_queueKey: string,
                snapshot_queueData: EventTransactionInfo
            ) => {

            if (!LocalUiPathAuth) {
                throw new Error("UiPath authentication not initialized");
            }

            if (snapshot_queueData.type ===DefaultQueueName_MeterRecord) {

                const line_event =
                    await getRealtimeDatabase(
                        LineEventsLogStorage,
                        snapshot_queueData.eventID,
                        'event'
                    );

                if (!line_event) {

                    throw new Error(
                        "line_events log not found."
                    );
                }

                const saveImageInfo =
                    await getRealtimeDatabase(
                        LineEventsLogStorage,
                        snapshot_queueData.eventID,
                        "saveImgPath"
                    );

                if (!saveImageInfo) {
                    throw new Error(
                        "saveImageInfo not found."
                    );
                }

                const queueName =
                    getLocalConfigValue(
                        strQueueName_MeterRecord,
                        DefaultQueueName_MeterRecord
                    );

                const content:
                    UnrecognizedImagesContent = {

                    LineEvent:JSON.stringify(line_event),
                    StorageBucket:storageBucket.value(),
                    PublicImageURL:saveImageInfo.publicURL,
                    ImagePath:saveImageInfo.filePath,
                    LogURL:
                        databaseURL.value() +
                        "/" +
                        lineEventRef +
                        "/" +
                        snapshot_queueData.eventID,
                    CreateDate:
                        snapshot_queueData.date +
                        " " +
                        snapshot_queueData.time
                };
                const queue_detail:
                    QueueItemDataDto = {
                    Name:queueName,
                    Priority:"Normal",
                    Reference:snapshot_queueData.eventID,
                    SpecificContent:content
                };
                const folder_info: Folder =
                    LocalUiPathAuth.folderInfo[strUiPathFolder_MeterRecord];
                await AddUiPathQueueItem(
                    queue_detail,
                    `${LocalUiPathAuth.token_type} ${LocalUiPathAuth.access_token}`,
                    folder_info.Id
                );
            } else if (snapshot_queueData.type ===DefaultQueueName_ERPSync) {
                const queueName =
                    getLocalConfigValue(strQueueName_ERPSync,DefaultQueueName_ERPSync);

                const queue_detail:
                    QueueItemDataDto = {
                    Name:queueName,
                    Priority:"Normal",
                    Reference:snapshot_queueData.eventID,
                    SpecificContent:
                        {
                            ...snapshot_queueData.parameters
                        }
                };
                const folder_info: Folder =
                    LocalUiPathAuth.folderInfo[
                        strUiPathFolder_ERPSync
                    ];

                await AddUiPathQueueItem(
                    queue_detail,
                    `${LocalUiPathAuth.token_type} ${LocalUiPathAuth.access_token}`,
                    folder_info.Id
                );

            } else {
                throw new Error(`Unknown Queue Type: ${snapshot_queueData.type}`);
            }
        };
        Listener_NewTransaction(
            IsInit,
            CallUipathAPITransactionQueue,
            DefaultCallUipathAPIEventPerformerCache,
            initializeUiPathTransaction,
            processUiPathEvent
        );
    } catch (error) {
        console.error("Failed to initialize server:", error);
    }
    
};

startServer();

/////////////////
/////modules/////
/////////////////
const isTokenExpired = (
    auth: uipathToken | null
): boolean => {

    if (!auth) return true;

    if (!auth.expired_time)
        return true;

    const tokenExpiresMoment =
        moment(
            auth.expired_time,
            'YYYYMMDDHHmmssSSS'
        ).tz('Asia/Bangkok');

    return moment()
        .tz('Asia/Bangkok')
        .isAfter(tokenExpiresMoment);
};

const releaseAuthenticationPendingTransactions =
    async (): Promise<void> => {
        console.log(`Releasing authentication pending transactions`);
    const snapshot =
        await CallUipathAPITransactionQueue
            .orderByChild("state")
            .equalTo(transactionState.pending_authentication).get();

    if (!snapshot.exists())return;

    const updates: any = {};

    snapshot.forEach((child) => {

        if (!child.key)
            return;

        updates[
            `${child.key}/state`
        ] = transactionState.new;
    });

    await CallUipathAPITransactionQueue
        .update(updates);

    console.log(
        `Released authentication pending transactions`
    );
};
const reauth = async ():
    Promise<uipathToken> => {

    console.log("re-authentication");

    const clientId =UIpathAppID.trim();

    const clientSecret =UIpathAppSecret
            .trim()
            .replace(/\\/g, "");

    const url ='https://cloud.uipath.com/identity_/connect/token';

    const method = 'POST';

    const headers = {
        'Content-Type':
            'application/x-www-form-urlencoded'
    };

    const data = qs.stringify({
        grant_type:
            'client_credentials',
        client_id:
            clientId,
        client_secret:
            clientSecret,
        scope:
            UipathScope
    });
    const response =
        await axios({
            url,
            method,
            headers,
            data,
            timeout: 15000
        });
    if (!response.data) {
        throw new Error(
            "Unknown authentication response"
        );
    }
    response.data.expired_time =
        moment()
            .tz('Asia/Bangkok')
            .add(
                moment.duration(
                    response.data.expires_in - 60,
                    'seconds'
                )
            )
            .format(
                'YYYYMMDDHHmmssSSS'
            );
    const accessToken =
        `${response.data.token_type} ${response.data.access_token}`;
    const allFolders = [
        {
            FolderKey:
                strUiPathFolder_MeterRecord,
            Default:
                DefaultUiPathFolder_MeterRecord
        },
        {
            FolderKey:
                strUiPathFolder_ERPSync,
            Default:
                DefaultUiPathFalder_ERPSync
        }
    ];
    const folderInfos: any = {};

    await Promise.all(

        allFolders.map(
            async (folder) => {

                const getConfigFolder =
                    getLocalConfigValue(
                        folder.FolderKey,
                        folder.Default
                    );

                const compare_value =
                    getConfigFolder
                        ? getConfigFolder
                        : folder.Default;

                const encodedCompareValue =
                    encodeURIComponent(
                        compare_value
                    );

                const MainURL =
                    UIpathCloudTenantAddress
                        .trim()
                        .replace(/\/$/, "") +
                    "/orchestrator_/odata/Folders";

                const folderInfoResponse =
                    await axios({

                        url:
                            `${MainURL}?%24filter=FullyQualifiedName%20eq%20%27${encodedCompareValue}%27`,

                        method: "GET",

                        headers: {

                            accept:
                                "application/json",

                            Authorization:
                                accessToken
                        },

                        timeout: 15000
                    });

                if (
                    folderInfoResponse.data &&
                    parseInt(
                        folderInfoResponse
                            .data["@odata.count"]
                    ) > 0
                ) {

                    folderInfos[
                        folder.FolderKey
                    ] =
                        folderInfoResponse
                            .data.value[0];

                } else {

                    folderInfos[
                        folder.FolderKey
                    ] =
                        "Folder not found";
                }
            }
        )
    );

    response.data.folderInfo =
        folderInfos;

    return response.data;
};

const ensureAuthenticated =
    async (): Promise<void> => {
    console.log("Ensuring authentication...");
    //already authenticated
    if (LocalUiPathAuth &&!isTokenExpired(LocalUiPathAuth)) return;

    //already authenticating
    if (AuthenticationPromise) {
        await AuthenticationPromise;
        return;
    }

    //create authentication lock
    AuthenticationPromise = (async () => {
        try {
            const auth =await reauth();
            LocalUiPathAuth =auth;
            await releaseAuthenticationPendingTransactions();
        } finally {
            AuthenticationPromise =null;
        }

    })();

    await AuthenticationPromise;
};

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
                const contentType = lineResponse.headers['content-type'];
                if (!contentType || typeof contentType !== 'string') {
                    throw new Error('Missing content-type header');
                }
                const [mimeType, extension] = contentType.split('/'); // ใช้ headers แทน data.type
                let LocalPath:string = getLocalConfigValue(strlocalImagePath, DefaultlocalImagePath);
                if(!LocalPath || LocalPath.trim()==""){ setRealtimeDatabase(LocalConfigs,DefaultlocalImagePath,strlocalImagePath,"");}
                const defaultPath:string = DefaultlocalImagePath
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
                const contentType = lineResponse.headers['content-type'];
                if (!contentType || typeof contentType !== 'string') {
                    throw new Error('Missing content-type header');
                }
                const [mimeType, extension] = contentType.split('/'); // ใช้ headers แทน data.type

                // Construct file path and access file reference
                const filePath = `images/${save_date}/img${messageName}.${extension}`;
                const file = bucket.file(filePath);

                // Upload the buffer data with metadata and return result
                await file.save(buffer, {
                  metadata: { contentType },
                  public: true,
                } as any);            

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
    const saveMethod= getLocalConfigValue(strsaveImageOnLocal, DefaultsaveImageOnLocal);
    const image_name = `${message.id}${message.imageSet?.index != undefined ? 'i' + message.imageSet?.index : '1'}_${Date.now().toString()}`;
    if(!saveMethod)setRealtimeDatabase(LocalConfigs,DefaultsaveImageOnLocal,strsaveImageOnLocal,"");

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
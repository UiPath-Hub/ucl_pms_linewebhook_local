//import * as logger from "firebase-functions/logger";
import moment from 'moment-timezone';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getDatabase, Reference ,DataSnapshot } from "firebase-admin/database";
import { Storage, Bucket, File } from '@google-cloud/storage';
//import { defineSecret, databaseURL, storageBucket, defineString } from 'firebase-functions/params';
const databaseURL = {value:()=>"https://ucl-pms-project-firebase-default-rtdb.asia-southeast1.firebasedatabase.app"};
const storageBucket = {value:()=>"gs://ucl-pms-project-firebase.firebasestorage.app"};
import axios from 'axios';
import {AxiosResponse} from 'axios';
//const { defineSecret } = require('firebase-functions/params');
import { AbortController } from 'node-abort-controller';

const qs = require('qs');
//require('./../tk.json');
const serviceAccount :any= require('./../ucl-pms-project-firebase-c6b10789f613.json');
const token = require("./../token.json");
const channelAccessToken= token.LINE_CHANNEL_ACCESS_TOKEN//: StringParam = defineString("LINE_CHANNEL_ACCESS_TOKEN");
const UIpathAppID=token.UIPATH_APP_ID//: StringParam = defineString("UIPATH_APP_ID");
const UIpathAppSecret=token.UIPATH_APP_SECRET//: StringParam = defineString("UIPATH_APP_SECRET");
const UIpathCloudTenantAddress=token.UIPATH_CLOUD_TENANT_ADDRESS//: StringParam = defineString("UIPATH_CLOUD_TENANT_ADDRESS");

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

initializeApp({
    credential: cert(serviceAccount),
    storageBucket: "gs://ucl-pms-project-firebase.firebasestorage.app",
    databaseURL: "https://ucl-pms-project-firebase-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const lineEventRef = "line_events";
const ImageEventPerformerName = "ImageEvents";
const CallUipathAPIEventPerformerName = "UiPathEvents";
const bucket: Bucket = getStorage().bucket();
const ServerInstanceDatabase = getDatabase().ref("/1736718113895");

ServerInstanceDatabase.on('value',(snapshot)=>{
  console.log(snapshot.val()) 
})
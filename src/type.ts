export type method = "GET" | "POST";
export type RequestContent = {
    method: method,
    headers: any,
    body?: any
}

export interface HTTPRequest {
    (url: string, method: method, headers: any, expectedReturn?: "blob" | "json", body?: any): Promise<any>
}

export interface BlobToBase64 {
    (blob: any): Promise<string>
}

export type SaveImageInfo = { "publicURL": string|"localhost", "filePath": string };

export type Emoji = {
    index: number;
    length: number;
    productId: string;
    emojiId: string;
};

export type Mentionee = {
    index: number;
    length: number;
    type: "user" | "all";
    userId?: string;
};

export type Mention = {
    mentionees: Mentionee[];
};

export interface MessagesHistory {
    Messages: string;
    Count: number;
    Reference: string;
}

export interface TextMessage {
    id: string;
    type: "text";
    quoteToken: string;
    text: string;
    emojis?: Emoji[];
    mention?: Mention;
    quotedMessageId?: string;
}

export interface ReplyMessages {
    "state": "waiting" | "pending";
    "messages": Record<string, string>[];
    "replyType": "reply" | "push";
    "BatchReference": string;
}

export interface PendingApprovalQueue {
    Reference: string;
    Data: string;
    ReplyFormat: string;
    ReplaceKeyFormat: string;
}

export interface UnrecognizedImagesContent {
    "LineEvent": string;
    "ImagePath": string;
    "PublicImageURL": string;
    "StorageBucket": string;
    "LogURL": string;
    "CreateDate": string;
}

export interface LineImageEventTransactionInfo{
    eventID:string,
    date:string,
    time:string,
    state:'new'|'process'|'failed'|'pending'|'successful'|string,
    retriesCount:number,
    timeStamp:number,
    output?:any
}


export interface PerformerCaches{
    cacheID:number,
    running:boolean,
    name:string,
    currentSaveImageTrace?:number,
}

export interface ImageMessage {
    id: string;
    type: string;
    quoteToken: string;
    contentProvider: {
        type: "line" | "external";
        originalContentUrl?: string;
        previewImageUrl?: string;
    };
    imageSet?: {
        id?: string;
        index?: number;
        total?: number;
    };
}

export interface UipathTokenObject {
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
    expires_time: string;
}

export interface ODataContext {
    "@odata.context": string;
    "@odata.count": number;
    value: Folder[];
}

export interface Folder {
    Key: string;
    DisplayName: string;
    FullyQualifiedName: string;
    FullyQualifiedNameOrderable: string;
    Description: string;
    FolderType: string;
    ProvisionType: string;
    PermissionModel: string;
    ParentId: number;
    ParentKey: string;
    IsActive: boolean;
    FeedType: string;
    ReservedOptions: any; // Assuming it can be any type since it's null in the example
    Id: number;
}

export interface QueueItemDataDto {
    Name: string;
    Priority: 'High' | 'Normal' | 'Low';
    SpecificContent: Record<string, any>;
    DeferDate?: string; // date-time
    DueDate?: string; // date-time
    RiskSlaDate?: string; // date-time
    Reference?: string; // maxLength: 128, minLength: 0
    Progress?: string;
    Source?: string; // maxLength: 20, minLength: 0, pattern: Manual|Apps
    ParentOperationId?: string; // maxLength: 128, minLength: 0
}

export interface TK {
    "App ID": string;
    "App Secret": string;
    "lineChS": string;
    "lineChAT": string;
    "tk": string;
}
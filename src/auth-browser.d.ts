export type DataMode = 'customer-private' | 'app-managed';
export interface RecoveryFile {format:'vcs-customer-key-v1'; endpoint:string; appId:string; userId:string; key:string}
export interface Identity {appId:string; userId:string; mode:DataMode; locked:boolean}
export interface RecordEntry<T=unknown> {key:string; value:T; version:number}
export interface AuthClient {
 signIn(options?:{resetToken?:string}):Promise<void>; finishSignIn(callbackUrl?:string):Promise<Identity>; resume():Promise<Identity>;
 prepareRecovery():Promise<RecoveryFile>; unlock(file:RecoveryFile,options?:{remember?:boolean}):Promise<{unlocked:true}>; exportRecovery():RecoveryFile;
 getEntry(key:string):Promise<RecordEntry>; get(key:string):Promise<unknown>; list():Promise<RecordEntry[]>;
 set(key:string,value:unknown,options:{version:number}):Promise<{key:string;version:number}>;
 delete(key:string,options:{version:number}):Promise<{ok:true}>;
 signOut(options?:{forgetDevice?:boolean}):Promise<void>;
 readonly signedIn:boolean; readonly locked:boolean; readonly mode:DataMode|undefined;
}
export function createAuthClient(options:{appId:string;redirectUri:string;endpoint?:string;sessionStore?:Storage;keyStore?:Storage}):AuthClient;

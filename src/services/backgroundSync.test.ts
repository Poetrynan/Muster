import { beforeEach,expect,it,vi } from 'vitest';
import { useAppStore } from '../stores/useAppStore';
import { startBackgroundSync } from './backgroundSync';
import type { SyncResult,SyncCallbacks } from './api';
vi.mock('./idbStorage',()=>({idbStorage:{getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}}}));
const user={id:1,username:'sample',fullName:'Synthetic Student',email:'sample@example.test',profileImage:''};
const course={id:10,fullName:'FIT5001 S2 2026',shortName:'FIT5001',category:'',visible:true};
const result:SyncResult={courses:[course],resources:[],assignments:[],announcements:[],tabs:[],unchangedCourseIds:[],fingerprints:{},requestsUsed:1,statusUpdates:[]};
beforeEach(()=>{useAppStore.getState().reset();useAppStore.getState().completeLogin(user);});
const tick=()=>new Promise(r=>setTimeout(r,0));
it('publishes courses before completion and eagerly loads recordings without mounting a page',async()=>{
 let callbacks!:SyncCallbacks,finish!:(r:SyncResult)=>void,calls=0;
 const transport=async(_options:any,cb?:SyncCallbacks)=>{calls++;callbacks=cb!;cb!.onData?.({courses:[course]});return new Promise<SyncResult>(resolve=>finish=resolve);};
 const pending=startBackgroundSync(false,transport);await tick();
 expect(useAppStore.getState().courses).toEqual([course]);expect(useAppStore.getState().syncStatus.isRunning).toBe(true);
 const duplicate=startBackgroundSync(false,transport);expect(calls).toBe(1);
 callbacks.onData?.({tabs:[{courseId:10,dashboard:null,unitInfo:null,schedule:null,recordings:[],contacts:[],loadedParts:['recordings']}],completed:{10:['recordings']}});
 expect(useAppStore.getState().recordings[10]).toEqual([]);expect(useAppStore.getState().syncStatus.lastSync).toBeUndefined();
 finish(result);await Promise.all([pending,duplicate]);expect(useAppStore.getState().syncStatus.isRunning).toBe(false);expect(useAppStore.getState().syncStatus.lastSync).toBeDefined();
});
it('cancels on logout and refuses old account/old epoch batches and final writes',async()=>{
 let callbacks!:SyncCallbacks,finish!:(r:SyncResult)=>void;
 const pending=startBackgroundSync(false,async(_o,cb)=>{callbacks=cb!;return new Promise(r=>finish=r);});await tick();
 useAppStore.getState().signOut(false);expect(callbacks.signal?.aborted).toBe(true);
 useAppStore.getState().completeLogin({...user,email:'other@example.test'});
 callbacks.onData?.({courses:[course]});finish(result);await expect(pending).rejects.toThrow('SYNC_CANCELLED');
 expect(useAppStore.getState().courses).toEqual([]);
});
it('retains prior freshness and successfully streamed data after a partial background failure',async()=>{
 useAppStore.getState().setSyncStatus({lastSync:'2026-10-01T00:00:00Z'});
 await expect(startBackgroundSync(false,async(_o,cb)=>{cb!.onData?.({courses:[course]});throw new Error('MOODLE_HTTP_503');})).rejects.toThrow('503');
 expect(useAppStore.getState().courses).toEqual([course]);expect(useAppStore.getState().syncStatus.lastSync).toBe('2026-10-01T00:00:00Z');expect(useAppStore.getState().syncStatus.isRunning).toBe(false);
});

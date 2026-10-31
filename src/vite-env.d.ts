/// <reference types="vite/client" />
declare global { interface Window { openharness: { invoke: (channel:string,data?:unknown)=>Promise<any>; on:(channel:string,callback:(data:any)=>void)=>()=>void } } }
export {};

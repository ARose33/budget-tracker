"use client";
import {Button} from "./button";
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from "./dialog";
export function ConfirmAction({open,onOpenChange,title,description,confirmLabel="Confirm",pending=false,onConfirm}:{open:boolean;onOpenChange:(open:boolean)=>void;title:string;description:string;confirmLabel?:string;pending?:boolean;onConfirm:()=>void}){
 return <Dialog open={open} onOpenChange={next=>{if(!pending)onOpenChange(next);}}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={pending} onClick={()=>onOpenChange(false)}>Cancel</Button><Button disabled={pending} onClick={onConfirm}>{pending?"Saving…":confirmLabel}</Button></DialogFooter></DialogContent></Dialog>;
}

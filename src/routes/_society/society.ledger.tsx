import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BookOpen, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";
import { EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { useSocietyId } from "@/hooks/useSocietyId";
import { journalRowSchema, listFinanceWorkspace } from "@/lib/finance-stage3d.functions";
import type { z } from "zod";

export const Route = createFileRoute("/_society/society/ledger")({ head:()=>({meta:[{title:"Journal — SociyoHub"}]}), component:()=> <FeatureGate feature="ledger"><JournalPage/></FeatureGate> });
const INR = new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2});
type JournalRow=z.infer<typeof journalRowSchema>;

function JournalPage(){
  const {societyId}=useSocietyId(); const list=useServerFn(listFinanceWorkspace);
  const [offset,setOffset]=useState(0); const pageSize=50;
  const q=useQuery({queryKey:["finance-journal",societyId,offset],enabled:!!societyId,queryFn:()=>list({data:{societyId:societyId!,resource:"journal",limit:pageSize,offset}}),retry:false});
  const rows=(q.data?.rows??[]) as JournalRow[];
  const totals=rows.reduce((a,r)=>({debit:a.debit+r.debit,credit:a.credit+r.credit}),{debit:0,credit:0});
  return <div className="pb-[calc(96px+env(safe-area-inset-bottom))]"><MobileHero eyebrow="Accounts Center" title="General journal" subtitle="Immutable balanced entries from verified source workflows." icon={BookOpen} variant="teal" stats={<StatPillRow><StatPill label="Debits" value={INR.format(totals.debit)} icon={TrendingUp}/><StatPill label="Credits" value={INR.format(totals.credit)} icon={TrendingDown}/><StatPill label="Entries on page" value={rows.length}/></StatPillRow>}/><div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8"><AccountsCenterTabs/><SectionCard title="Posted journal" description="Legacy manual ledger is preserved read-only and excluded" bodyClassName="p-0">{q.isLoading?<div className="p-10 grid place-items-center"><Loader2 className="animate-spin"/></div>:q.error?<div className="p-5 space-y-3"><p className="text-sm text-destructive">{(q.error as Error).message}</p><Button size="sm" variant="outline" onClick={()=>q.refetch()}>Retry</Button></div>:!rows.length&&offset===0?<div className="p-6"><EmptyState icon={BookOpen} title="No journal entries" description="Verified payments, income and posted expenses will appear here."/></div>:<><ListCardGroup>{rows.map(r=><ListCard key={r.id} title={r.description} subtitle={`${r.transaction_date} · ${r.source_type} · ${r.status}`} meta={r.reversal_of?"Reversal":undefined} trailing={<div className="text-right text-sm"><div>Dr {INR.format(r.debit)}</div><div className="text-muted-foreground">Cr {INR.format(r.credit)}</div></div>}/>)}</ListCardGroup><div className="flex items-center justify-between border-t p-3"><Button size="sm" variant="outline" disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-pageSize))}>Previous</Button><span className="text-xs text-muted-foreground">Page {Math.floor(offset/pageSize)+1}</span><Button size="sm" variant="outline" disabled={rows.length<pageSize} onClick={()=>setOffset(value=>value+pageSize)}>Next</Button></div></>}</SectionCard></div></div>;
}

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toSafeFinanceMessage } from "@/lib/finance-safe-error";
import { useState } from "react";
import { FinanceFilterBar, EMPTY_FILTERS, activeFilterCount, type FinanceFilters } from "@/components/finance/FinanceFilterBar";
import { BookOpen, Download, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { writeSafeWorkbook } from "@/lib/spreadsheet-safety";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";
import { EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { useSocietyId } from "@/hooks/useSocietyId";
import { journalRowSchema, listFinanceFiltered } from "@/lib/finance-stage3d.functions";
import type { z } from "zod";
import { tu } from "@/lib/i18n";

const STATUS_LABEL:Record<string,string>={posted:"Posted",reversed:"Reversed",reversal:"Reversal",draft:"Draft",pending:"Pending",verified:"Verified",reconciled:"Reconciled",voided:"Voided"};
const statusLabel=(s?:string|null)=>s?(STATUS_LABEL[s]??s.replace(/_/g," ")):"";
const sourceLabel=(s?:string|null)=>s?s.replace(/_/g," "):"";
export const Route = createFileRoute("/_society/society/ledger")({ head:()=>({meta:[
  {title:"General Journal — SociyoHub"},
  {name:"description",content:"Review immutable, balanced society journal entries."},
  {property:"og:title",content:"General Journal — SociyoHub"},
  {property:"og:description",content:"Immutable, balanced society journal entries."},
  {property:"og:type",content:"website"},
  {name:"twitter:card",content:"summary"},
]}), component:()=> <FeatureGate feature="ledger"><JournalPage/></FeatureGate> });
const INR = new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2});
type JournalRow=z.infer<typeof journalRowSchema>;

function JournalPage(){
  const {societyId}=useSocietyId(); const listFiltered=useServerFn(listFinanceFiltered);
  const [offset,setOffset]=useState(0); const pageSize=50;
  const [filters,setFiltersRaw]=useState<FinanceFilters>(EMPTY_FILTERS); const setFilters=(f:FinanceFilters)=>{setFiltersRaw(f);setOffset(0);}; const rangeOk=!(filters.from&&filters.to&&filters.from>filters.to); const filtering=activeFilterCount(filters)>0;
  const fq=useQuery({queryKey:["finance-journal",societyId,"filtered",filters,offset],enabled:!!societyId&&rangeOk,placeholderData:(p)=>p,queryFn:()=>listFiltered({data:{societyId:societyId!,resource:"journal",from:filters.from||null,to:filters.to||null,category:filters.category==="all"?null:filters.category,status:filters.status==="all"?null:filters.status as any,limit:pageSize,offset}}),retry:false});
  const q=fq;
  const rows=(q.data?.rows??[]) as JournalRow[];
  const totals=q.data?.totals??{debit:0,credit:0,count:0};
  const [exporting,setExporting]=useState(false);
  const exportJournal=async()=>{
    if(exporting||!societyId||!rangeOk)return; setExporting(true);
    try{
      const all:JournalRow[]=[];
      for(let off=0;off<5000;off+=200){
        const res=await listFiltered({data:{societyId,resource:"journal",from:filters.from||null,to:filters.to||null,category:filters.category==="all"?null:filters.category,status:filters.status==="all"?null:filters.status as any,limit:200,offset:off}});
        const chunk=(res.rows??[]) as JournalRow[]; all.push(...chunk);
        if(chunk.length<200||all.length>=res.totals.count)break;
      }
      if(!all.length){toast.info(tu("op.no_entries_match_these_filters"));return;}
      writeSafeWorkbook(all.map(r=>({Date:r.transaction_date,Description:r.description,Reference:r.reference??"",Source:sourceLabel(r.source_type),Status:statusLabel(r.status),"Reversal of an earlier entry":r.reversal_of?"Yes":"No","Debit (Rs.)":r.debit,"Credit (Rs.)":r.credit})),"Journal",`general-journal-${filters.from||"all"}-to-${filters.to||"all"}.xlsx`);
      toast.success(`Downloaded ${all.length} entr${all.length===1?"y":"ies"}.`);
    }catch(e){toast.error(toSafeFinanceMessage(e,"Couldn't download the journal. Please try again."));}
    finally{setExporting(false);}
  };
  return <div className="pb-[calc(96px+env(safe-area-inset-bottom))]"><MobileHero eyebrow={tu("accountsTabs.label")} title={tu("op.general_journal")} subtitle={tu("op.immutable_balanced_entries_from_verified")} icon={BookOpen} variant="teal" stats={<StatPillRow><StatPill label={tu("op.debits")} value={q.data?INR.format(totals.debit):"—"} icon={TrendingUp}/><StatPill label={tu("op.credits")} value={q.data?INR.format(totals.credit):"—"} icon={TrendingDown}/><StatPill label={filtering?tu("op.matching_entries"):tu("op.entries")} value={q.data?totals.count:"—"}/></StatPillRow>}/><div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8"><AccountsCenterTabs/><SectionCard title={tu("op.filter_entries")} bodyClassName="p-3"><FinanceFilterBar value={filters} onChange={setFilters} statuses={[{value:"posted",label:"Posted"},{value:"reversed",label:"Reversed"}]}/></SectionCard><div className="flex justify-end"><Button variant="outline" className="min-h-11" disabled={exporting||!rangeOk||!totals.count} onClick={()=>void exportJournal()}>{exporting?<Loader2 className="mr-1 h-4 w-4 animate-spin"/>:<Download className="mr-1 h-4 w-4"/>}{tu("op.download_journal")}</Button></div><SectionCard title={tu("op.posted_journal")} description={tu("op.legacy_manual_ledger_is_preserved")} bodyClassName="p-0">{q.isLoading?<div className="p-10 grid place-items-center"><Loader2 className="animate-spin"/></div>:q.error?<div className="p-5 space-y-3"><p className="text-sm text-destructive">{toSafeFinanceMessage(q.error,"This list couldn't load. Please try again.")}</p><Button size="sm" variant="outline" onClick={()=>q.refetch()}>{tu("common.retry")}</Button></div>:!rows.length&&offset===0?<div className="p-6">{filtering?<div className="space-y-3 text-center"><EmptyState icon={BookOpen} title={tu("op.no_entries_match_these_filters_2")} description={tu("op.try_a_wider_date_range")}/><Button size="sm" variant="outline" onClick={()=>setFilters(EMPTY_FILTERS)}>{tu("exp.clearFilters")}</Button></div>:<EmptyState icon={BookOpen} title={tu("op.no_journal_entries")} description={tu("op.verified_payments_income_and_posted")}/>}</div>:<><ListCardGroup>{rows.map(r=><ListCard key={r.id} title={r.description} subtitle={`${r.transaction_date} · ${sourceLabel(r.source_type)} · ${statusLabel(r.status)}`} meta={r.reversal_of?"Reversal":undefined} trailing={<div className="text-right text-sm"><div>Dr {INR.format(r.debit)}</div><div className="text-muted-foreground">Cr {INR.format(r.credit)}</div></div>}/>)}</ListCardGroup><div className="flex items-center justify-between border-t p-3"><Button size="sm" variant="outline" disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-pageSize))}>{tu("acc.previous")}</Button><span className="text-xs text-muted-foreground">{totals.count?`${offset+1}–${offset+rows.length} of ${totals.count}`:""}{q.data?.truncated?tu("op.latest_5_000_scanned"):""}</span><Button size="sm" variant="outline" disabled={offset+rows.length>=totals.count} onClick={()=>setOffset(value=>value+pageSize)}>{tu("acc.next")}</Button></div></>}</SectionCard></div></div>;
}

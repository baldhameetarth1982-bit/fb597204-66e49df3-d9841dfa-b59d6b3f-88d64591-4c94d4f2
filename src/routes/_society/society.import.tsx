import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useMemo, useState } from "react";
import {
  Upload, Loader2, FileDown, CheckCircle2, AlertTriangle, Info, ClipboardList, ListChecks, Send,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_society/society/import")({
  head: () => ({ meta: [{ title: "Bulk Import — SocioHub" }] }),
  component: () => (<FeatureGate feature="resident_import"><ImportPage /></FeatureGate>),
});

type RawRow = Record<string, unknown>;
type NormRow = {
  idx: number;
  block: string;
  flat_number: string;
  resident_name: string;
  phone: string;
  email: string;
  type: string;
  property_number: string;
  ugvcl_number: string;
  share_certificate_number: string;
  offline: boolean;
  errors: string[];
};

const PHONE_RE = /^[+]?\d[\d\s-]{7,14}\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function truthy(v: unknown) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "y";
}

function pick(r: RawRow, keys: string[]) {
  for (const k of keys) {
    const v = r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()];
    if (v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function ImportPage() {
  const { societyId } = useSocietyId();
  const [rows, setRows] = useState<NormRow[]>([]);
  const [existingFlatKeys, setExistingFlatKeys] = useState<Set<string>>(new Set());
  const [existingPhones, setExistingPhones] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ flats: number; residents: number; errors: string[] } | null>(null);

  const summary = useMemo(() => {
    const total = rows.length;
    const invalid = rows.filter((r) => r.errors.length > 0).length;
    return { total, valid: total - invalid, invalid };
  }, [rows]);

  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet([
      {
        block: "A", flat_number: "101", resident_name: "Ravi Patel", phone: "9000000001",
        email: "ravi@example.com", type: "owner", property_number: "P-101",
        ugvcl_number: "UG12345", share_certificate_number: "SC-001", offline: "no",
      },
      {
        block: "A", flat_number: "102", resident_name: "Priya Shah", phone: "9000000002",
        email: "", type: "tenant", property_number: "", ugvcl_number: "",
        share_certificate_number: "", offline: "yes",
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Residents");
    XLSX.writeFile(wb, "sociohub-residents-template.xlsx");
  }

  async function onFile(file: File) {
    if (!societyId) return;
    setResult(null);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });

    // Fetch existing flats + phones for duplicate detection
    const [flatsRes, profilesRes] = await Promise.all([
      supabase
        .from("flats")
        .select("flat_number, blocks!flats_block_id_fkey(name)")
        .eq("society_id", societyId),
      supabase.from("profiles").select("phone").eq("society_id", societyId).not("phone", "is", null),
    ]);
    const flatKeys = new Set<string>();
    for (const f of (flatsRes.data ?? []) as any[]) {
      flatKeys.add(`${(f.blocks?.name ?? "").toLowerCase()}/${String(f.flat_number).toLowerCase()}`);
    }
    const phones = new Set<string>();
    for (const p of profilesRes.data ?? []) {
      if (p.phone) phones.add(String(p.phone).replace(/\D/g, ""));
    }
    setExistingFlatKeys(flatKeys);
    setExistingPhones(phones);

    // Normalize + validate rows
    const seenKeys = new Set<string>();
    const seenPhones = new Set<string>();
    const norm: NormRow[] = data.map((raw, idx) => {
      const block = pick(raw, ["block", "Block", "tower", "Tower", "structure", "Structure"]);
      const flat_number = pick(raw, ["flat_number", "Flat", "Unit", "house", "House", "flat"]);
      const resident_name = pick(raw, ["resident_name", "Name", "name", "resident"]);
      const phone = pick(raw, ["phone", "Phone", "mobile", "Mobile"]).replace(/\s|-/g, "");
      const email = pick(raw, ["email", "Email"]);
      const type = pick(raw, ["type", "Type", "relationship"]).toLowerCase() || "owner";
      const property_number = pick(raw, ["property_number", "Property No", "property"]);
      const ugvcl_number = pick(raw, ["ugvcl_number", "UGVCL", "ugvcl"]);
      const share_certificate_number = pick(raw, ["share_certificate_number", "Share Cert", "share_cert"]);
      const offline = truthy(raw.offline ?? (raw as any).Offline);

      const errors: string[] = [];
      if (!block) errors.push("Missing block/tower");
      if (!flat_number) errors.push("Missing house number");
      if (resident_name && !offline && !phone) errors.push("Phone required for online residents");
      if (phone && !PHONE_RE.test(phone)) errors.push("Invalid phone format");
      if (email && !EMAIL_RE.test(email)) errors.push("Invalid email format");
      if (type && !["owner", "tenant", "family"].includes(type)) errors.push("Type must be owner/tenant/family");

      const key = `${block.toLowerCase()}/${flat_number.toLowerCase()}`;
      if (block && flat_number) {
        if (seenKeys.has(key)) errors.push("Duplicate house in this file");
        seenKeys.add(key);
      }
      const phoneDigits = phone.replace(/\D/g, "");
      if (phoneDigits) {
        if (seenPhones.has(phoneDigits)) errors.push("Duplicate mobile in this file");
        else if (phones.has(phoneDigits)) errors.push("Mobile already exists in society");
        seenPhones.add(phoneDigits);
      }

      return {
        idx: idx + 2, // Excel row (+ header)
        block, flat_number, resident_name, phone, email, type,
        property_number, ugvcl_number, share_certificate_number, offline, errors,
      };
    });
    setRows(norm);
  }

  async function commit() {
    if (!societyId || !rows.length) return;
    const validRows = rows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) {
      toast.error("No valid rows to import. Fix errors and re-upload.");
      return;
    }
    setBusy(true);
    const errors: string[] = [];
    let flatCount = 0;
    let resCount = 0;

    // 1. Blocks
    const blockNames = Array.from(new Set(validRows.map((r) => r.block)));
    const existingBlocks = await supabase.from("blocks").select("id,name").eq("society_id", societyId);
    if (existingBlocks.error) {
      toast.error(existingBlocks.error.message);
      setBusy(false);
      return;
    }
    const blockMap = new Map<string, string>();
    for (const b of existingBlocks.data ?? []) blockMap.set(b.name.toLowerCase(), b.id);
    for (const name of blockNames) {
      if (!blockMap.has(name.toLowerCase())) {
        const { data, error } = await supabase
          .from("blocks").insert({ society_id: societyId, name }).select("id").single();
        if (error) errors.push(`Row: block ${name}: ${error.message}`);
        else blockMap.set(name.toLowerCase(), data!.id);
      }
    }

    // 2. Flats
    const flatKey = (block: string, n: string) => `${block.toLowerCase()}/${n.toLowerCase()}`;
    const existingFlats = await supabase
      .from("flats")
      .select("id,flat_number,blocks!flats_block_id_fkey(name)")
      .eq("society_id", societyId);
    const flatMap = new Map<string, string>();
    for (const f of (existingFlats.data ?? []) as any[]) {
      flatMap.set(flatKey(f.blocks?.name ?? "", f.flat_number), f.id);
    }

    for (const r of validRows) {
      const bid = blockMap.get(r.block.toLowerCase());
      if (!bid) continue;
      const key = flatKey(r.block, r.flat_number);
      if (!flatMap.has(key)) {
        const { data, error } = await supabase
          .from("flats")
          .insert({ society_id: societyId, block_id: bid, flat_number: r.flat_number })
          .select("id")
          .single();
        if (error) {
          errors.push(`Row ${r.idx} (${key}): ${error.message}`);
          continue;
        }
        flatMap.set(key, data!.id);
        flatCount++;
      }
    }

    // 3. Offline residents
    for (const r of validRows) {
      if (!r.resident_name || !r.offline) continue;
      const fid = flatMap.get(flatKey(r.block, r.flat_number));
      if (!fid) continue;
      const { error } = await supabase.from("offline_residents").insert({
        society_id: societyId,
        flat_id: fid,
        full_name: r.resident_name,
        phone: r.phone || null,
        email: r.email || null,
      });
      if (error) errors.push(`Row ${r.idx} (${r.resident_name}): ${error.message}`);
      else resCount++;
    }

    setResult({ flats: flatCount, residents: resCount, errors });
    setBusy(false);
    if (errors.length === 0) toast.success(`Imported ${flatCount} houses and ${resCount} residents`);
    else toast.warning(`Imported with ${errors.length} issue${errors.length === 1 ? "" : "s"}`);
  }
  const currentStep: 1 | 2 | 3 =
    result ? 3 : rows.length > 0 ? 2 : 1;

  function downloadErrorReport() {
    const errored = rows.filter((r) => r.errors.length > 0);
    if (!errored.length) return;
    const rowsOut = errored.map((r) => ({
      excel_row: r.idx,
      block: r.block,
      flat_number: r.flat_number,
      resident_name: r.resident_name,
      phone: r.phone,
      email: r.email,
      type: r.type,
      errors: r.errors.join("; "),
    }));
    const ws = XLSX.utils.json_to_sheet(rowsOut);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Errors");
    XLSX.writeFile(wb, "sociohub-import-errors.xlsx");
  }

  const steps = [
    { n: 1 as const, label: "Upload", icon: Upload },
    { n: 2 as const, label: "Review", icon: ClipboardList },
    { n: 3 as const, label: "Done", icon: ListChecks },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Bulk Import Residents"
        description="Upload an Excel file to add blocks, houses, and offline residents in one shot."
      />

      {/* Step tracker */}
      <div className="mb-4 flex items-center gap-2">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const active = currentStep === s.n;
          const done = currentStep > s.n;
          return (
            <div key={s.n} className="flex items-center gap-2 flex-1">
              <div className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border w-full",
                active ? "border-primary bg-primary text-primary-foreground" :
                done ? "border-success-container bg-success-container text-success-container-foreground" :
                "border-border bg-card text-muted-foreground",
              )}>
                <Icon className="h-3.5 w-3.5" />
                <span className="truncate">Step {s.n}: {s.label}</span>
              </div>
              {i < steps.length - 1 && <div className="h-px flex-1 bg-border hidden sm:block" />}
            </div>
          );
        })}
      </div>

      <Card className="rounded-2xl mb-4">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadTemplate} className="rounded-xl">
              <FileDown className="h-4 w-4 mr-1.5" /> Download template
            </Button>
            <label className="inline-flex">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
              <Button asChild className="rounded-xl">
                <span><Upload className="h-4 w-4 mr-1.5" /> Choose file</span>
              </Button>
            </label>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground flex items-start gap-2">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p>
                Columns: <code>block, flat_number, resident_name, phone, email, type, property_number, ugvcl_number, share_certificate_number, offline</code>
              </p>
              <p>Set <code>offline=yes</code> for residents who don't use the app. Online residents sign up &amp; join via invite code.</p>
              <p>Validation runs on upload. Only valid rows are imported — the file is never partially applied for corrupted data.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card className="rounded-2xl mb-4">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold">Preview · {summary.total} rows</p>
                <StatusChip tone="success">{summary.valid} valid</StatusChip>
                {summary.invalid > 0 && <StatusChip tone="danger">{summary.invalid} with errors</StatusChip>}
              </div>
              <div className="flex gap-2 flex-wrap">
                {summary.invalid > 0 && (
                  <Button variant="outline" size="sm" onClick={downloadErrorReport} className="rounded-xl">
                    <FileDown className="h-3.5 w-3.5 mr-1.5" />Error report
                  </Button>
                )}
                <Button onClick={commit} disabled={busy || summary.valid === 0} className="rounded-xl">
                  {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                  Review &amp; import {summary.valid}
                </Button>
              </div>
            </div>
            <div className="overflow-auto max-h-96 rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    {["#", "Block", "House", "Name", "Phone", "Type", "Errors"].map((h) => (
                      <th key={h} className="p-2 text-left font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 300).map((r) => (
                    <tr key={r.idx} className={cn("border-t border-border", r.errors.length && "bg-danger-container/40")}>
                      <td className="p-2 text-muted-foreground">{r.idx}</td>
                      <td className="p-2">{r.block}</td>
                      <td className="p-2">{r.flat_number}</td>
                      <td className="p-2">{r.resident_name || "—"}</td>
                      <td className="p-2">{r.phone || "—"}</td>
                      <td className="p-2 capitalize">{r.type}</td>
                      <td className="p-2 text-destructive text-[10px]">
                        {r.errors.length ? r.errors.join("; ") : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 300 && (
              <p className="text-[11px] text-muted-foreground">Showing first 300 rows in preview. All valid rows will be imported.</p>
            )}
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-success-container text-success-container-foreground grid place-items-center">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">Import complete</p>
                <p className="text-xs text-muted-foreground">Created {result.flats} houses · {result.residents} offline residents.</p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-xl border border-warning-container bg-warning-container/40 p-3">
                <div className="flex items-center gap-2 text-warning-container-foreground font-medium text-sm">
                  <AlertTriangle className="h-4 w-4" />
                  {result.errors.length} row{result.errors.length === 1 ? "" : "s"} had issues
                </div>
                <ul className="mt-1.5 list-disc pl-5 text-xs text-muted-foreground max-h-32 overflow-y-auto">
                  {result.errors.slice(0, 30).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

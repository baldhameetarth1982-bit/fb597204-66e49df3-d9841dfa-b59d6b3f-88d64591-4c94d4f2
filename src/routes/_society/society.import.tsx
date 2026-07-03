import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Upload, Loader2, FileDown, CheckCircle2, AlertTriangle, Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_society/society/import")({
  head: () => ({ meta: [{ title: "Bulk Import — SocioHub" }] }),
  component: ImportPage,
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

  return (
    <PageShell>
      <PageHeader
        title="Bulk Import Residents"
        description="Upload an Excel file to add blocks, houses, and offline residents in one shot"
      />

      <Card className="rounded-2xl">
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
              <p>Set <code>offline=yes</code> for residents who don't use the app. Online residents sign up & join via invite code.</p>
              <p>Validation runs on upload; invalid rows won't be imported.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium">Preview · {summary.total} rows</p>
                <Badge variant="outline" className="border-emerald-500/30 text-emerald-600">
                  {summary.valid} valid
                </Badge>
                {summary.invalid > 0 && (
                  <Badge variant="outline" className="border-rose-500/30 text-rose-600">
                    {summary.invalid} with errors
                  </Badge>
                )}
              </div>
              <Button onClick={commit} disabled={busy || summary.valid === 0} className="rounded-xl">
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Import {summary.valid} row{summary.valid === 1 ? "" : "s"}
              </Button>
            </div>
            <div className="overflow-auto max-h-96 rounded-xl border">
              <table className="w-full text-xs">
                <thead className="bg-secondary sticky top-0">
                  <tr>
                    {["#", "Block", "House", "Name", "Phone", "Type", "Errors"].map((h) => (
                      <th key={h} className="p-2 text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 300).map((r) => (
                    <tr key={r.idx} className={r.errors.length ? "border-t bg-rose-500/5" : "border-t"}>
                      <td className="p-2 text-muted-foreground">{r.idx}</td>
                      <td className="p-2">{r.block}</td>
                      <td className="p-2">{r.flat_number}</td>
                      <td className="p-2">{r.resident_name || "—"}</td>
                      <td className="p-2">{r.phone || "—"}</td>
                      <td className="p-2 capitalize">{r.type}</td>
                      <td className="p-2 text-rose-600 text-[10px]">
                        {r.errors.length ? r.errors.join("; ") : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
              Created {result.flats} houses · {result.residents} offline residents
            </div>
            {result.errors.length > 0 && (
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2 text-amber-600">
                  <AlertTriangle className="h-4 w-4" /> {result.errors.length} issue{result.errors.length === 1 ? "" : "s"}
                </div>
                <ul className="list-disc pl-5 text-xs text-muted-foreground">
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

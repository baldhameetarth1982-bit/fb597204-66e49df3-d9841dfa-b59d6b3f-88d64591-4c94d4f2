/**
 * Society Setup Wizard — metadata-driven step definitions.
 * Every step is a pure component + validator; add/remove/reorder without
 * touching WizardRunner navigation.
 */
import { useMemo, useState, useEffect } from "react";
import {
  Building2, Home, Layers, Wallet, Receipt, ListChecks, ShieldCheck,
  Plus, Trash2, GripVertical, Upload, Loader2, Sparkles, CheckCircle2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { WizardDef, WizardStep, StepProps } from "./WizardRunner";
import {
  generateStructureUnits, generateSerialUnits, findDuplicateCodes,
  type NumberingFormat, type StructureConfig, type GeneratedUnit,
} from "@/lib/hierarchy/numbering";
import type { DynamicField, WizardStructure } from "@/lib/hierarchy.functions";

export interface WizardState {
  info: {
    name: string;
    registration_no: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
    logo_url: string;
    email: string;
  };
  layout: "structured" | "serial";
  structure_label: string;
  structures: WizardStructure[];
  serial_count: number;
  serial_units: GeneratedUnit[];
  opening: { cash: number; bank: number; as_of: string };
  maintenance: {
    amount: number;
    billing_type: "prepaid" | "current" | "postpaid";
    due_day: number;
    grace_days: number;
    late_fee_amount: number;
    late_fee_type: "flat" | "percent";
    auto_generate: boolean;
    frequency: "monthly" | "quarterly" | "half_yearly" | "yearly";
  };
  dynamic_fields: DynamicField[];
  financial_year_label: string;
}

const CURRENT_YEAR = new Date().getFullYear();
const NEXT = (CURRENT_YEAR + 1).toString().slice(-2);

export const initialWizardState: WizardState = {
  info: { name: "", registration_no: "", address: "", city: "", state: "", pincode: "", logo_url: "", email: "" },
  layout: "structured",
  structure_label: "Block",
  structures: [],
  serial_count: 0,
  serial_units: [],
  opening: { cash: 0, bank: 0, as_of: new Date().toISOString().slice(0, 10) },
  maintenance: {
    amount: 0, billing_type: "current", due_day: 10, grace_days: 5,
    late_fee_amount: 0, late_fee_type: "flat", auto_generate: true, frequency: "monthly",
  },
  dynamic_fields: [],
  financial_year_label: `${CURRENT_YEAR}-${NEXT}`,
};

/* ---------- Reusable field ---------- */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ---------- 1. Society Info ---------- */
function StepInfo({ state, patch }: StepProps<WizardState>) {
  const [uploading, setUploading] = useState(false);
  async function upload(file: File) {
    setUploading(true);
    try {
      const path = `logos/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("public-assets").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("public-assets").getPublicUrl(path);
      patch({ info: { ...state.info, logo_url: data.publicUrl } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-16 w-16 rounded-2xl bg-secondary grid place-items-center overflow-hidden">
          {state.info.logo_url ? (
            <img src={state.info.logo_url} alt="Logo" className="h-full w-full object-cover" />
          ) : (
            <Building2 className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-primary cursor-pointer">
          <Upload className="h-4 w-4" />
          {uploading ? "Uploading…" : "Upload logo (optional)"}
          <input
            type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
      </div>

      <Field label="Society name">
        <Input className="h-11 rounded-xl" value={state.info.name}
          onChange={(e) => patch({ info: { ...state.info, name: e.target.value } })}
          placeholder="Green Meadows Society" />
      </Field>
      <Field label="Registration number (optional)">
        <Input className="h-11 rounded-xl" value={state.info.registration_no}
          onChange={(e) => patch({ info: { ...state.info, registration_no: e.target.value } })} />
      </Field>
      <Field label="Full address">
        <Textarea rows={2} value={state.info.address}
          onChange={(e) => patch({ info: { ...state.info, address: e.target.value } })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City">
          <Input className="h-11 rounded-xl" value={state.info.city}
            onChange={(e) => patch({ info: { ...state.info, city: e.target.value } })} />
        </Field>
        <Field label="State">
          <Input className="h-11 rounded-xl" value={state.info.state}
            onChange={(e) => patch({ info: { ...state.info, state: e.target.value } })} />
        </Field>
      </div>
      <Field label="PIN code">
        <Input className="h-11 rounded-xl" inputMode="numeric" maxLength={6}
          value={state.info.pincode}
          onChange={(e) => patch({ info: { ...state.info, pincode: e.target.value.replace(/\D/g, "") } })} />
      </Field>
      <Field label="Email (optional)">
        <Input className="h-11 rounded-xl" type="email" value={state.info.email}
          onChange={(e) => patch({ info: { ...state.info, email: e.target.value } })} />
      </Field>
    </div>
  );
}

/* ---------- 2. Layout choice ---------- */
function StepLayout({ state, patch }: StepProps<WizardState>) {
  const options: Array<{ id: WizardState["layout"]; icon: React.ElementType; title: string; desc: string; examples: string }> = [
    {
      id: "structured", icon: Building2, title: "Structured Society",
      desc: "Apartments, towers, wings, buildings — anything with floors.",
      examples: "e.g. Block A → Floor 1 → Flat 101",
    },
    {
      id: "serial", icon: Home, title: "Serial Number Society",
      desc: "Row houses, villas, bungalows, gated communities.",
      examples: "e.g. House 1, House 2, House 3…",
    },
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">How is your society organised?</p>
      {options.map((o) => {
        const Icon = o.icon;
        const active = state.layout === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => patch({ layout: o.id })}
            className={cn(
              "w-full text-left rounded-3xl border-2 p-4 transition-all",
              active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
            )}
          >
            <div className="flex items-start gap-3">
              <div className={cn(
                "h-11 w-11 rounded-2xl grid place-items-center shrink-0",
                active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
              )}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{o.title}</h3>
                  {active && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{o.desc}</p>
                <p className="text-[11px] text-muted-foreground mt-2 italic">{o.examples}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- 3. Structure naming (structured only) ---------- */
function StepStructureNaming({ state, patch }: StepProps<WizardState>) {
  const labels = ["Wing", "Tower", "Block", "Building", "Sector", "Phase"];
  const [count, setCount] = useState(state.structures.length || 3);

  useEffect(() => {
    // Sync structures list when count / label changes
    setCount(state.structures.length || 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(n: number) {
    const clamped = Math.max(1, Math.min(50, Math.floor(n || 1)));
    const existing = state.structures;
    const next: WizardStructure[] = [];
    for (let i = 0; i < clamped; i++) {
      if (existing[i]) {
        next.push(existing[i]);
      } else {
        const letter = String.fromCharCode(65 + i);
        next.push({
          name: `${state.structure_label} ${letter}`,
          code: letter,
          floors: 4,
          units_per_floor: 4,
          ground_floor: false,
          numbering_format: "sequential",
          units: [],
        });
      }
    }
    patch({ structures: next });
    setCount(clamped);
  }

  return (
    <div className="space-y-4">
      <Field label="What do you call your structures?">
        <div className="grid grid-cols-3 gap-2">
          {labels.map((l) => (
            <button
              key={l} type="button"
              onClick={() => patch({ structure_label: l })}
              className={cn(
                "h-11 rounded-xl border text-sm font-medium",
                state.structure_label === l
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-secondary",
              )}
            >{l}</button>
          ))}
        </div>
        <Input
          className="h-11 rounded-xl mt-2"
          placeholder="Or type a custom label"
          value={labels.includes(state.structure_label) ? "" : state.structure_label}
          onChange={(e) => patch({ structure_label: e.target.value })}
        />
      </Field>

      <Field label={`Number of ${state.structure_label}s`}>
        <div className="flex gap-2">
          <Input
            className="h-11 rounded-xl" type="number" min={1} max={50}
            value={count}
            onChange={(e) => setCount(+e.target.value)}
          />
          <Button variant="secondary" className="h-11 rounded-xl" onClick={() => apply(count)}>
            Generate
          </Button>
        </div>
      </Field>

      {state.structures.length > 0 && (
        <Field label={`${state.structures.length} ${state.structure_label}${state.structures.length > 1 ? "s" : ""} — rename any`}>
          <div className="space-y-2">
            {state.structures.map((s, i) => (
              <Input
                key={i} className="h-11 rounded-xl" value={s.name}
                onChange={(e) => {
                  const next = [...state.structures];
                  next[i] = { ...next[i], name: e.target.value };
                  patch({ structures: next });
                }}
              />
            ))}
          </div>
        </Field>
      )}
    </div>
  );
}

/* ---------- 4. Configure each structure ---------- */
function StepConfigureStructures({ state, patch }: StepProps<WizardState>) {
  const [idx, setIdx] = useState(0);
  const s = state.structures[idx];
  if (!s) return <div className="text-sm text-muted-foreground">Add a structure first.</div>;

  const preview = useMemo<GeneratedUnit[]>(() => generateStructureUnits({
    name: s.name, code: s.code,
    floors: s.floors, unitsPerFloor: s.units_per_floor,
    groundFloor: s.ground_floor,
    numberingFormat: s.numbering_format as NumberingFormat,
    customPattern: s.custom_pattern,
  }), [s]);

  function update(patchS: Partial<WizardStructure>) {
    const next = [...state.structures];
    // Regenerate units on every change so the wizard state always carries a valid list
    const merged = { ...next[idx], ...patchS };
    const units = generateStructureUnits({
      name: merged.name, code: merged.code,
      floors: merged.floors, unitsPerFloor: merged.units_per_floor,
      groundFloor: merged.ground_floor,
      numberingFormat: merged.numbering_format as NumberingFormat,
      customPattern: merged.custom_pattern,
    });
    next[idx] = { ...merged, units };
    patch({ structures: next });
  }

  return (
    <div className="space-y-4">
      {state.structures.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {state.structures.map((st, i) => (
            <button
              key={i} type="button" onClick={() => setIdx(i)}
              className={cn(
                "shrink-0 px-3 h-9 rounded-full text-xs font-medium border",
                i === idx ? "bg-primary text-primary-foreground border-primary" : "border-border",
              )}
            >{st.name}</button>
          ))}
        </div>
      )}

      <Field label="Structure name">
        <Input className="h-11 rounded-xl" value={s.name}
          onChange={(e) => update({ name: e.target.value })} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Number of floors">
          <Input className="h-11 rounded-xl" type="number" min={1} max={100}
            value={s.floors}
            onChange={(e) => update({ floors: Math.max(1, +e.target.value || 1) })} />
        </Field>
        <Field label="Units per floor">
          <Input className="h-11 rounded-xl" type="number" min={1} max={100}
            value={s.units_per_floor}
            onChange={(e) => update({ units_per_floor: Math.max(1, +e.target.value || 1) })} />
        </Field>
      </div>

      <div className="flex items-center justify-between rounded-xl border p-3">
        <div>
          <p className="text-sm font-medium">Ground floor</p>
          <p className="text-[11px] text-muted-foreground">Include a floor 0 in addition to floors 1..N</p>
        </div>
        <Switch checked={s.ground_floor} onCheckedChange={(v) => update({ ground_floor: v })} />
      </div>

      <Field label="Numbering format">
        <Select value={s.numbering_format} onValueChange={(v) => update({ numbering_format: v })}>
          <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sequential">Sequential — 101, 102, 201, 202</SelectItem>
            <SelectItem value="simple">Simple — 1, 2, 3, 4</SelectItem>
            <SelectItem value="floor_unit">Floor–Unit — 1F-01, 1F-02</SelectItem>
            <SelectItem value="custom">Custom pattern</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {s.numbering_format === "custom" && (
        <Field
          label="Custom pattern"
          hint="Tokens: {S} structure code · {F}/{FF} floor · {N}/{NN} unit · {G}/{GGG} global. Example: {S}-{F}{NN}"
        >
          <Input className="h-11 rounded-xl" value={s.custom_pattern ?? ""}
            placeholder="{S}-{F}{NN}"
            onChange={(e) => update({ custom_pattern: e.target.value })} />
        </Field>
      )}

      <div className="rounded-2xl border bg-muted/30 p-3">
        <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Live preview · {preview.length} units
        </p>
        <div className="grid grid-cols-4 gap-1.5 max-h-52 overflow-y-auto">
          {preview.slice(0, 60).map((u, i) => (
            <div key={i} className="h-9 rounded-md bg-background border text-[11px] grid place-items-center">
              {u.code}
            </div>
          ))}
          {preview.length > 60 && (
            <div className="col-span-4 text-center text-[11px] text-muted-foreground pt-1">
              +{preview.length - 60} more
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- 5. Serial count (serial only) ---------- */
function StepSerialCount({ state, patch }: StepProps<WizardState>) {
  const preview = useMemo(() => generateSerialUnits(state.serial_count), [state.serial_count]);

  useEffect(() => {
    patch({ serial_units: preview });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.length]);

  return (
    <div className="space-y-4">
      <Field label="Total houses" hint="We'll auto-number them 1, 2, 3, … — edit any in the next step.">
        <Input className="h-14 rounded-xl text-2xl font-semibold text-center"
          type="number" min={1} max={20000}
          value={state.serial_count || ""}
          onChange={(e) => patch({ serial_count: Math.max(0, +e.target.value || 0) })} />
      </Field>

      {preview.length > 0 && (
        <div className="rounded-2xl border bg-muted/30 p-3">
          <p className="text-xs font-semibold mb-2">Preview — first 20 houses</p>
          <div className="grid grid-cols-5 gap-1.5">
            {preview.slice(0, 20).map((u, i) => (
              <div key={i} className="h-9 rounded-md bg-background border text-[11px] grid place-items-center">
                {u.code}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- 6. Unit editor (rename / delete / insert) ---------- */
function StepUnitEditor({ state, patch }: StepProps<WizardState>) {
  const [structIdx, setStructIdx] = useState(0);
  const isSerial = state.layout === "serial";
  const units: GeneratedUnit[] = isSerial ? state.serial_units : state.structures[structIdx]?.units ?? [];
  const dupes = useMemo(() => findDuplicateCodes(units), [units]);

  function setUnits(next: GeneratedUnit[]) {
    if (isSerial) {
      patch({ serial_units: next, serial_count: next.length });
    } else {
      const s = [...state.structures];
      s[structIdx] = { ...s[structIdx], units: next };
      patch({ structures: s });
    }
  }

  return (
    <div className="space-y-3">
      {!isSerial && state.structures.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {state.structures.map((st, i) => (
            <button key={i} type="button" onClick={() => setStructIdx(i)}
              className={cn(
                "shrink-0 px-3 h-9 rounded-full text-xs font-medium border",
                i === structIdx ? "bg-primary text-primary-foreground border-primary" : "border-border",
              )}>{st.name}</button>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {units.length} units{dupes.size > 0 && (
          <span className="text-destructive font-medium"> · {dupes.size} duplicate code(s)</span>
        )}
      </p>

      <div className="rounded-2xl border divide-y max-h-[55vh] overflow-y-auto">
        {units.map((u, i) => (
          <div key={i} className="flex items-center gap-2 p-2">
            <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              className={cn(
                "h-9 rounded-md text-sm",
                dupes.has((u.code || "").toLowerCase()) && "border-destructive",
              )}
              value={u.code}
              onChange={(e) => {
                const next = [...units];
                next[i] = { ...next[i], code: e.target.value, name: e.target.value };
                setUnits(next);
              }}
            />
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0"
              onClick={() => setUnits(units.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        ))}
      </div>

      <Button variant="outline" className="w-full h-11 rounded-xl"
        onClick={() => {
          const next = [...units, { code: "", name: "", floor: 0 }];
          setUnits(next);
        }}>
        <Plus className="h-4 w-4 mr-2" /> Add unit
      </Button>
    </div>
  );
}

/* ---------- 7. Opening balances ---------- */
function StepOpening({ state, patch }: StepProps<WizardState>) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 text-xs text-amber-900 dark:text-amber-200">
        Opening balances <strong>lock forever</strong> after you finish setup. Future corrections must be Adjustment entries.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cash on hand (₹)">
          <Input className="h-11 rounded-xl" type="number" min={0} step="0.01"
            value={state.opening.cash}
            onChange={(e) => patch({ opening: { ...state.opening, cash: +e.target.value || 0 } })} />
        </Field>
        <Field label="Bank balance (₹)">
          <Input className="h-11 rounded-xl" type="number" min={0} step="0.01"
            value={state.opening.bank}
            onChange={(e) => patch({ opening: { ...state.opening, bank: +e.target.value || 0 } })} />
        </Field>
      </div>
      <Field label="As of date">
        <Input className="h-11 rounded-xl" type="date"
          value={state.opening.as_of}
          onChange={(e) => patch({ opening: { ...state.opening, as_of: e.target.value } })} />
      </Field>
      <Field label="Financial year">
        <Input className="h-11 rounded-xl" value={state.financial_year_label}
          onChange={(e) => patch({ financial_year_label: e.target.value })} />
      </Field>
    </div>
  );
}

/* ---------- 8. Maintenance policy ---------- */
function StepMaintenance({ state, patch }: StepProps<WizardState>) {
  const m = state.maintenance;
  const up = (p: Partial<WizardState["maintenance"]>) => patch({ maintenance: { ...m, ...p } });
  return (
    <div className="space-y-4">
      <Field label="Monthly maintenance amount (₹)">
        <Input className="h-11 rounded-xl" type="number" min={0} step="0.01"
          value={m.amount} onChange={(e) => up({ amount: +e.target.value || 0 })} />
      </Field>
      <Field label="Billing type">
        <Select value={m.billing_type} onValueChange={(v) => up({ billing_type: v as any })}>
          <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="prepaid">Prepaid — bill before period starts</SelectItem>
            <SelectItem value="current">Current month — bill during period</SelectItem>
            <SelectItem value="postpaid">Postpaid — bill after period</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Frequency">
        <Select value={m.frequency} onValueChange={(v) => up({ frequency: v as any })}>
          <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="quarterly">Quarterly</SelectItem>
            <SelectItem value="half_yearly">Half-yearly</SelectItem>
            <SelectItem value="yearly">Yearly</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bill due day (1–28)">
          <Input className="h-11 rounded-xl" type="number" min={1} max={28}
            value={m.due_day} onChange={(e) => up({ due_day: Math.max(1, Math.min(28, +e.target.value || 1)) })} />
        </Field>
        <Field label="Grace period (days)">
          <Input className="h-11 rounded-xl" type="number" min={0} max={30}
            value={m.grace_days} onChange={(e) => up({ grace_days: Math.max(0, Math.min(30, +e.target.value || 0)) })} />
        </Field>
      </div>
      <Field label="Late fee">
        <div className="flex gap-2">
          <Input className="h-11 rounded-xl" type="number" min={0}
            value={m.late_fee_amount}
            onChange={(e) => up({ late_fee_amount: Math.max(0, +e.target.value || 0) })} />
          <Select value={m.late_fee_type} onValueChange={(v) => up({ late_fee_type: v as any })}>
            <SelectTrigger className="h-11 w-28 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="flat">₹ Flat</SelectItem>
              <SelectItem value="percent">% of dues</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Field>
      <div className="flex items-center justify-between rounded-xl border p-3">
        <div>
          <p className="text-sm font-medium">Automatic bill generation</p>
          <p className="text-[11px] text-muted-foreground">
            Generate bills on schedule. Bills stay unpaid until marked or paid online.
          </p>
        </div>
        <Switch checked={m.auto_generate} onCheckedChange={(v) => up({ auto_generate: v })} />
      </div>
    </div>
  );
}

/* ---------- 9. Dynamic profile fields (optional) ---------- */
const TEMPLATES: Array<{ label: string; key: string; type: DynamicField["type"] }> = [
  { label: "Property Number", key: "property_number", type: "text" },
  { label: "Electric Meter", key: "electric_meter", type: "text" },
  { label: "Water Meter", key: "water_meter", type: "text" },
  { label: "Gas Connection", key: "gas_connection", type: "text" },
  { label: "Parking Slot", key: "parking_slot", type: "text" },
  { label: "Vehicle Number", key: "vehicle_number", type: "text" },
];

function StepDynamicFields({ state, patch }: StepProps<WizardState>) {
  function add(f: DynamicField) {
    if (state.dynamic_fields.some((x) => x.key === f.key)) return;
    patch({ dynamic_fields: [...state.dynamic_fields, f] });
  }
  function remove(key: string) {
    patch({ dynamic_fields: state.dynamic_fields.filter((f) => f.key !== key) });
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Optional. Add custom fields residents can fill on their profile (property number, meter numbers, parking, etc.). You can always add more later.
      </p>
      <div>
        <p className="text-xs font-semibold mb-2">Quick add</p>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((t) => {
            const added = state.dynamic_fields.some((f) => f.key === t.key);
            return (
              <button key={t.key} type="button"
                onClick={() => (added ? remove(t.key) : add(t))}
                className={cn(
                  "px-3 h-9 rounded-full text-xs font-medium border",
                  added ? "bg-primary/10 border-primary text-primary" : "border-border hover:bg-secondary",
                )}>
                {added ? "✓ " : "+ "}{t.label}
              </button>
            );
          })}
        </div>
      </div>

      {state.dynamic_fields.length > 0 && (
        <div className="rounded-2xl border divide-y">
          {state.dynamic_fields.map((f) => (
            <div key={f.key} className="flex items-center justify-between p-3">
              <div>
                <p className="text-sm font-medium">{f.label}</p>
                <p className="text-[11px] text-muted-foreground">{f.type}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => remove(f.key)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- 10. Review ---------- */
function StepReview({ state }: StepProps<WizardState>) {
  const totalUnits = state.layout === "serial"
    ? state.serial_units.length
    : state.structures.reduce((a, s) => a + s.units.length, 0);

  return (
    <div className="space-y-3">
      <Card className="rounded-2xl"><CardContent className="p-4 space-y-1.5 text-sm">
        <Row k="Society" v={state.info.name || "—"} />
        <Row k="Address" v={[state.info.address, state.info.city, state.info.state, state.info.pincode].filter(Boolean).join(", ") || "—"} />
        <Row k="Layout" v={state.layout === "structured" ? "Structured" : "Serial number"} />
        {state.layout === "structured" && (
          <Row k={`${state.structure_label}s`} v={String(state.structures.length)} />
        )}
        <Row k="Total units" v={String(totalUnits)} />
        <Row k="Opening cash" v={`₹${state.opening.cash.toLocaleString("en-IN")}`} />
        <Row k="Opening bank" v={`₹${state.opening.bank.toLocaleString("en-IN")}`} />
        <Row k="Financial year" v={state.financial_year_label} />
        <Row k="Maintenance" v={`₹${state.maintenance.amount} · ${state.maintenance.frequency} · due day ${state.maintenance.due_day}`} />
        <Row k="Auto bills" v={state.maintenance.auto_generate ? "On" : "Off"} />
        <Row k="Custom fields" v={String(state.dynamic_fields.length)} />
      </CardContent></Card>
      <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 text-xs text-amber-900 dark:text-amber-200">
        Tapping <strong>Finish setup</strong> will lock opening balances and initialize your society. You can still edit maintenance policy and add units later.
      </div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
  );
}

/* ---------- Definition ---------- */
export function buildSocietySetupWizard(): WizardDef<WizardState> {
  const steps: WizardStep<WizardState>[] = [
    {
      id: "info", title: "Society information", subtitle: "Tell us about your society",
      Component: StepInfo,
      validate: (s) => s.info.name.trim().length >= 3
        ? { ok: true }
        : { ok: false, message: "Enter a society name (at least 3 characters)" },
    },
    {
      id: "layout", title: "Choose layout", subtitle: "How is your society organised?",
      Component: StepLayout,
    },
    {
      id: "naming", title: "Structure naming", subtitle: "What do you call your buildings?",
      Component: StepStructureNaming,
      visible: (s) => s.layout === "structured",
      validate: (s) => s.structures.length > 0
        ? { ok: true }
        : { ok: false, message: "Add at least one structure" },
    },
    {
      id: "configure", title: "Configure structures", subtitle: "Floors, units, and numbering",
      Component: StepConfigureStructures,
      visible: (s) => s.layout === "structured",
      validate: (s) => {
        for (const st of s.structures) {
          if (st.units.length === 0) return { ok: false, message: `${st.name}: generate at least 1 unit` };
        }
        return { ok: true };
      },
    },
    {
      id: "serial", title: "How many houses?", subtitle: "One number — we'll generate them all",
      Component: StepSerialCount,
      visible: (s) => s.layout === "serial",
      validate: (s) => s.serial_units.length > 0
        ? { ok: true }
        : { ok: false, message: "Enter total houses (at least 1)" },
    },
    {
      id: "editor", title: "Edit units", subtitle: "Rename, delete, or add units",
      Component: StepUnitEditor,
      validate: (s) => {
        const units = s.layout === "serial"
          ? s.serial_units
          : s.structures.flatMap((x) => x.units);
        if (units.length === 0) return { ok: false, message: "Add at least one unit" };
        if (units.some((u) => !u.code.trim())) return { ok: false, message: "Every unit needs a code" };
        const dupes = findDuplicateCodes(units);
        if (dupes.size > 0) return { ok: false, message: `Remove ${dupes.size} duplicate unit code(s)` };
        return { ok: true };
      },
    },
    {
      id: "opening", title: "Opening balances", subtitle: "Starting cash and bank",
      Component: StepOpening,
    },
    {
      id: "maintenance", title: "Maintenance policy", subtitle: "Bills and late fees",
      Component: StepMaintenance,
    },
    {
      id: "dynamic", title: "Custom profile fields", subtitle: "Optional resident fields",
      Component: StepDynamicFields,
    },
    {
      id: "review", title: "Review & finish", subtitle: "Double-check before locking in",
      Component: StepReview,
    },
  ];
  return { id: "society-setup", steps, initial: initialWizardState };
}

import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Eye, Archive, FileText, Coins, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  listChargeHeads,
  saveChargeHead,
  listBillingTemplates,
  saveBillingTemplate,
  listTemplateLines,
  saveTemplateLine,
  archiveTemplateLine,
  previewBillingTemplate,
  listBillingCycles,
  configureBillingCycle,
  type PreviewResult,
} from "@/lib/billing-config.functions";

type ChargeHead = { id: string; name: string; category: string; default_amount: number | null; active: boolean };
type Template = { id: string; name: string; status: string; billing_frequency: string; effective_from: string; effective_to: string | null };
type Line = {
  id: string;
  charge_head_id: string;
  rule_type: "fixed_per_unit" | "unit_type_amount" | "area_based" | "manual_variable";
  amount: number | null;
  unit_type: string | null;
  rate_per_area: number | null;
  area_unit: string | null;
  required_approval: boolean;
  sort_order: number;
  active: boolean;
};
type Cycle = {
  id: string;
  template_id: string;
  cycle_name: string;
  period_start: string;
  period_end: string;
  due_date: string;
  status: "draft" | "ready" | "archived";
};

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function BillingConfigCard({ societyId }: { societyId: string }) {
  const listHeads = useServerFn(listChargeHeads);
  const saveHead = useServerFn(saveChargeHead);
  const listTpls = useServerFn(listBillingTemplates);
  const saveTpl = useServerFn(saveBillingTemplate);
  const listLines = useServerFn(listTemplateLines);
  const saveLine = useServerFn(saveTemplateLine);
  const archLine = useServerFn(archiveTemplateLine);
  const previewFn = useServerFn(previewBillingTemplate);
  const listCyclesFn = useServerFn(listBillingCycles);
  const configureCycleFn = useServerFn(configureBillingCycle);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [heads, setHeads] = useState<ChargeHead[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [activeTpl, setActiveTpl] = useState<Template | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cycleOpen, setCycleOpen] = useState(false);

  const [headOpen, setHeadOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [lineOpen, setLineOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [h, t, c] = await Promise.all([
        listHeads({ data: { societyId } }),
        listTpls({ data: { societyId } }),
        listCyclesFn({ data: { societyId } }),
      ]);
      setHeads((h.chargeHeads as ChargeHead[]) ?? []);
      setTemplates((t.templates as Template[]) ?? []);
      setCycles((c.cycles as Cycle[]) ?? []);
      if (t.templates?.length && !activeTpl) setActiveTpl(t.templates[0] as Template);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load billing configuration";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function refreshLines(tplId: string) {
    try {
      const r = await listLines({ data: { societyId, templateId: tplId } });
      setLines((r.lines as Line[]) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load template lines");
    }
  }

  async function refreshCycles() {
    try {
      const c = await listCyclesFn({ data: { societyId } });
      setCycles((c.cycles as Cycle[]) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load billing cycles");
    }
  }

  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [societyId]);
  useEffect(() => { if (activeTpl) void refreshLines(activeTpl.id); else setLines([]); /* eslint-disable-next-line */ }, [activeTpl?.id]);

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-5 w-5 text-primary" /> Billing configuration
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Configure charge heads, templates, and preview per-unit calculations. Preview is safe — no bills are generated in this stage.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : errorMsg ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {errorMsg}
            <div className="mt-2">
              <Button size="sm" variant="outline" className="rounded-xl" onClick={() => void refresh()}>Retry</Button>
            </div>
          </div>
        ) : (
          <>
            {/* Charge heads */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold flex items-center gap-1.5"><Coins className="h-4 w-4" /> Charge heads</p>
                  <p className="text-xs text-muted-foreground">Reusable line items (Maintenance, Water, Sinking Fund…).</p>
                </div>
                <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setHeadOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              </div>
              {heads.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No charge heads yet.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-2">
                  {heads.map((h) => (
                    <li key={h.id} className="rounded-lg border p-2 text-xs flex items-center justify-between">
                      <span className="truncate">
                        <span className="font-medium">{h.name}</span>
                        <span className="text-muted-foreground"> · {h.category}</span>
                      </span>
                      {!h.active && <Badge variant="secondary">archived</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Templates */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Templates</p>
                  <p className="text-xs text-muted-foreground">A template groups charge heads with per-unit rules.</p>
                </div>
                <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setTplOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> New template
                </Button>
              </div>
              {templates.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No templates yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setActiveTpl(t)}
                      className={`rounded-lg border px-3 py-1.5 text-xs text-left ${activeTpl?.id === t.id ? "border-primary bg-primary/5" : ""}`}
                    >
                      <div className="font-medium">{t.name}</div>
                      <div className="text-[10px] text-muted-foreground">{t.status} · {t.billing_frequency}</div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Lines for active template */}
            {activeTpl && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Lines · {activeTpl.name}</p>
                    <p className="text-xs text-muted-foreground">Per-unit rules that make up this template.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setLineOpen(true)} disabled={heads.filter(h => h.active).length === 0}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add line
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-xl"
                      onClick={async () => {
                        try {
                          const r = await previewFn({ data: { societyId, templateId: activeTpl.id, limit: 25, offset: 0 } });
                          setPreview(r.preview);
                          setPreviewOpen(true);
                        } catch (e: any) {
                          toast.error(e.message ?? "Preview failed");
                        }
                      }}
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" /> Preview
                    </Button>
                  </div>
                </div>
                {lines.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No lines yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {lines.map((l) => {
                      const head = heads.find((h) => h.id === l.charge_head_id);
                      return (
                        <li key={l.id} className="flex items-center justify-between rounded-lg border p-2 text-xs">
                          <div className="min-w-0">
                            <div className="font-medium">{head?.name ?? "—"}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {ruleLabel(l)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {!l.active && <Badge variant="secondary">archived</Badge>}
                            {l.active && (
                              <Button
                                size="icon" variant="ghost" className="h-7 w-7"
                                onClick={async () => {
                                  try { await archLine({ data: { societyId, id: l.id } }); toast.success("Line archived"); void refreshLines(activeTpl.id); }
                                  catch (e: any) { toast.error(e.message ?? "Archive failed"); }
                                }}
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </CardContent>

      {/* Add charge head */}
      <ChargeHeadDialog
        open={headOpen}
        onOpenChange={setHeadOpen}
        onSave={async (v) => {
          await saveHead({ data: { societyId, ...v } });
          toast.success("Charge head saved");
          void refresh();
        }}
      />
      {/* New template */}
      <TemplateDialog
        open={tplOpen}
        onOpenChange={setTplOpen}
        onSave={async (v) => {
          await saveTpl({ data: { societyId, ...v } });
          toast.success("Template saved");
          void refresh();
        }}
      />
      {/* New line */}
      {activeTpl && (
        <LineDialog
          open={lineOpen}
          onOpenChange={setLineOpen}
          heads={heads.filter((h) => h.active)}
          onSave={async (v) => {
            await saveLine({ data: { societyId, templateId: activeTpl.id, ...v } });
            toast.success("Line added");
            void refreshLines(activeTpl.id);
          }}
        />
      )}
      {/* Preview */}
      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} preview={preview} />
    </Card>
  );
}

function ruleLabel(l: Line) {
  switch (l.rule_type) {
    case "fixed_per_unit": return `Fixed per unit · ${fmt.format(Number(l.amount ?? 0))}`;
    case "unit_type_amount": return `By unit type (${l.unit_type ?? "?"}) · ${fmt.format(Number(l.amount ?? 0))}`;
    case "area_based": return `Area-based · ₹${l.rate_per_area ?? 0}/${l.area_unit ?? "sqft"}`;
    case "manual_variable": return "Manual variable (entered at bill generation)";
  }
}

/* --------- Dialogs --------- */

function ChargeHeadDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (v: { name: string; category: string; defaultAmount: number | null }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("general");
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setName(""); setCategory("general"); setAmount(""); } }}>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>New charge head</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Maintenance" /></div>
          <div><Label>Category</Label><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="general" /></div>
          <div><Label>Default amount (optional)</Label><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !name.trim()} onClick={async () => {
            setBusy(true);
            try { await onSave({ name: name.trim(), category: category.trim() || "general", defaultAmount: amount ? Number(amount) : null }); onOpenChange(false); }
            catch (e: any) { toast.error(e.message ?? "Save failed"); }
            finally { setBusy(false); }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (v: { name: string; status: "draft"; billingFrequency: "monthly"; effectiveFrom: string }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setName(""); }}>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>New billing template</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="FY 2026-27 Monthly" /></div>
          <div><Label>Effective from</Label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !name.trim()} onClick={async () => {
            setBusy(true);
            try { await onSave({ name: name.trim(), status: "draft", billingFrequency: "monthly", effectiveFrom }); onOpenChange(false); }
            catch (e: any) { toast.error(e.message ?? "Save failed"); }
            finally { setBusy(false); }
          }}>Save draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LineDialog({ open, onOpenChange, heads, onSave }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  heads: ChargeHead[];
  onSave: (v: { chargeHeadId: string; ruleType: Line["rule_type"]; amount: number | null; unitType: string | null; ratePerArea: number | null; areaUnit: string | null; sortOrder: number }) => Promise<void>;
}) {
  const [chargeHeadId, setChargeHeadId] = useState<string>(heads[0]?.id ?? "");
  const [ruleType, setRuleType] = useState<Line["rule_type"]>("fixed_per_unit");
  const [amount, setAmount] = useState<string>("");
  const [unitType, setUnitType] = useState<string>("");
  const [ratePerArea, setRatePerArea] = useState<string>("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && heads[0]) setChargeHeadId(heads[0].id); }, [open, heads]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Add template line</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Charge head</Label>
            <select className="w-full h-10 rounded-md border bg-background px-2 text-sm" value={chargeHeadId} onChange={(e) => setChargeHeadId(e.target.value)}>
              {heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Rule</Label>
            <select className="w-full h-10 rounded-md border bg-background px-2 text-sm" value={ruleType} onChange={(e) => setRuleType(e.target.value as Line["rule_type"])}>
              <option value="fixed_per_unit">Fixed per unit</option>
              <option value="unit_type_amount">By unit type (e.g. 2BHK)</option>
              <option value="area_based">Area-based (₹ / sqft)</option>
              <option value="manual_variable">Manual variable (entered at generation)</option>
            </select>
          </div>
          {(ruleType === "fixed_per_unit" || ruleType === "unit_type_amount") && (
            <div><Label>Amount (₹)</Label><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          )}
          {ruleType === "unit_type_amount" && (
            <div><Label>Unit type</Label><Input value={unitType} onChange={(e) => setUnitType(e.target.value)} placeholder="2BHK" /></div>
          )}
          {ruleType === "area_based" && (
            <div><Label>Rate per sqft (₹)</Label><Input inputMode="decimal" value={ratePerArea} onChange={(e) => setRatePerArea(e.target.value)} /></div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !chargeHeadId} onClick={async () => {
            setBusy(true);
            try {
              await onSave({
                chargeHeadId,
                ruleType,
                amount: ruleType === "fixed_per_unit" || ruleType === "unit_type_amount" ? Number(amount || 0) : null,
                unitType: ruleType === "unit_type_amount" ? unitType.trim() || null : null,
                ratePerArea: ruleType === "area_based" ? Number(ratePerArea || 0) : null,
                areaUnit: ruleType === "area_based" ? "sqft" : null,
                sortOrder: 0,
              });
              onOpenChange(false);
            } catch (e: any) { toast.error(e.message ?? "Save failed"); }
            finally { setBusy(false); }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({ open, onOpenChange, preview }: { open: boolean; onOpenChange: (o: boolean) => void; preview: PreviewResult | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preview · no bills generated</DialogTitle>
        </DialogHeader>
        {!preview ? (
          <p className="text-sm text-muted-foreground">No data.</p>
        ) : (
          <div className="space-y-3 max-h-[70vh] overflow-auto">
            <div className="rounded-lg bg-muted/50 p-3 text-xs grid grid-cols-3 gap-2">
              <div><div className="text-muted-foreground">Units</div><div className="font-semibold">{preview.total_units}</div></div>
              <div><div className="text-muted-foreground">Total (all units)</div><div className="font-semibold">{fmt.format(preview.summary.total_amount)}</div></div>
              <div><div className="text-muted-foreground">Area warnings</div><div className="font-semibold">{preview.summary.area_warning_units}</div></div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Showing first {preview.units.length} of {preview.total_units} units. This is a preview only; no bills are created.
            </p>
            <ul className="space-y-1.5">
              {preview.units.map((u) => (
                <li key={u.flat_id} className="rounded-lg border p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{u.block_name ? `${u.block_name} · ` : ""}{u.flat_number}</span>
                    <span className={u.has_warning ? "text-amber-600 font-semibold" : "font-semibold"}>{fmt.format(u.unit_total)}</span>
                  </div>
                  {u.has_warning && <div className="text-[10px] text-amber-600 mt-0.5">Some lines need attention (area missing or manual entry)</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

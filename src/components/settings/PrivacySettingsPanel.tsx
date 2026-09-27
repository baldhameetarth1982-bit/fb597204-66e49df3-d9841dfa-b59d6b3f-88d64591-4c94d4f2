import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RotateCcw, CheckCircle2, WifiOff, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSocietyId } from "@/hooks/useSocietyId";
import { getSocietyPrivacy, setSocietyPrivacy } from "@/lib/team-admin.functions";
import {
  PRIVACY_DIRECTORY, PRIVACY_CONTACTS, PRIVACY_FINANCES,
  PRIVACY_VEHICLES, PRIVACY_DOCUMENTS,
  PRIVACY_LABELS, PRIVACY_DESCRIPTIONS,
  type SocietyPrivacySettings,
} from "@/lib/role-permissions";

type Key = keyof SocietyPrivacySettings;

const ROWS: {
  key: Key;
  group: keyof typeof PRIVACY_LABELS;
  title: string;
  hint: string;
  options: readonly string[];
}[] = [
  { key: "privacy_directory", group: "directory", title: "Member directory",
    hint: "Whether residents can browse the list of other residents.", options: PRIVACY_DIRECTORY },
  { key: "privacy_contacts", group: "contacts", title: "Phone numbers and emails",
    hint: "Who can see a resident's phone number and email.", options: PRIVACY_CONTACTS },
  { key: "privacy_finances", group: "finances", title: "Society finances",
    hint: "How much of the society's income and expenses residents can see.", options: PRIVACY_FINANCES },
  { key: "privacy_vehicles", group: "vehicles", title: "Vehicles",
    hint: "Who can see a resident's registered vehicles.", options: PRIVACY_VEHICLES },
  { key: "privacy_documents", group: "documents", title: "Documents",
    hint: "Who can see a resident's uploaded documents.", options: PRIVACY_DOCUMENTS },
];

function errorKind(e: unknown): "forbidden" | "offline" | "other" {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  const msg = (e as Error | undefined)?.message ?? "";
  if (msg === "forbidden") return "forbidden";
  if (/fetch|network/i.test(msg)) return "offline";
  return "other";
}

export function PrivacySettingsPanel() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const qc = useQueryClient();
  const fnGet = useServerFn(getSocietyPrivacy);
  const fnSet = useServerFn(setSocietyPrivacy);
  const queryKey = ["society-privacy", societyId] as const;

  const q = useQuery({
    enabled: !!societyId,
    queryKey,
    retry: (n, e) => errorKind(e) !== "forbidden" && n < 1,
    queryFn: () => fnGet({ data: { societyId: societyId! } }),
  });

  const [draft, setDraft] = useState<SocietyPrivacySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => { if (q.data) setDraft(q.data); }, [q.data]);

  if (sidLoading || (q.isLoading && !!societyId)) {
    return (
      <div className="flex justify-center py-10" role="status" aria-label="Loading privacy settings">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!societyId) {
    return <p className="text-sm text-muted-foreground">No society is selected.</p>;
  }

  if (q.isError || !q.data || !draft) {
    const kind = errorKind(q.error);
    return (
      <div className="rounded-xl border border-dashed p-4 space-y-3 text-center">
        <div className="mx-auto h-10 w-10 rounded-full bg-muted grid place-items-center">
          {kind === "offline" ? <WifiOff className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
        </div>
        <p className="text-sm">
          {kind === "forbidden"
            ? "Only Society Admins can view and change privacy settings."
            : kind === "offline"
              ? "You seem to be offline. Your settings couldn't be loaded."
              : "Privacy settings couldn't be loaded, so they can't be changed right now."}
        </p>
        {kind !== "forbidden" && (
          <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Try again
          </Button>
        )}
      </div>
    );
  }

  const saved = q.data;
  const dirty = ROWS.some((r) => draft[r.key] !== saved[r.key]);

  async function handleSave() {
    if (!societyId || !draft || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await fnSet({ data: { societyId, ...draft } });
      // Re-read the authoritative saved values from the server.
      await qc.invalidateQueries({ queryKey });
      setSavedAt(Date.now());
      toast.success("Privacy settings saved");
    } catch (e) {
      const kind = errorKind(e);
      const msg = kind === "forbidden"
        ? "You don't have permission to change these settings."
        : kind === "offline"
          ? "You're offline. Nothing was saved."
          : "Couldn't save. Nothing was changed. Please try again.";
      setSaveError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {ROWS.map((r) => {
        const labels = PRIVACY_LABELS[r.group] as Record<string, string>;
        const descs = PRIVACY_DESCRIPTIONS[r.group] as Record<string, string>;
        const value = draft[r.key];
        const changed = value !== saved[r.key];
        const id = `privacy-${r.key}`;
        return (
          <div key={r.key} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={id} className="text-sm font-semibold">{r.title}</Label>
              {changed && <span className="text-[11px] font-medium text-primary">Not saved</span>}
            </div>
            <p className="text-xs text-muted-foreground">{r.hint}</p>
            <Select
              value={value}
              onValueChange={(v) => { setSavedAt(null); setSaveError(null); setDraft({ ...draft, [r.key]: v } as SocietyPrivacySettings); }}
              disabled={saving}
            >
              <SelectTrigger id={id} className="rounded-xl min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                {r.options.map((o) => (<SelectItem key={o} value={o}>{labels[o] ?? o}</SelectItem>))}
              </SelectContent>
            </Select>
            <p className="text-xs text-foreground/80 rounded-lg bg-muted/50 px-3 py-2">{descs[value] ?? ""}</p>
          </div>
        );
      })}

      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
      {savedAt && !dirty && !saveError && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
          <CheckCircle2 className="h-4 w-4 text-primary" /> Saved. Changes apply to everyone right away and are recorded.
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" className="min-h-11 rounded-xl" disabled={!dirty || saving} onClick={() => { setDraft(saved); setSaveError(null); }}>
          Discard changes
        </Button>
        <Button className="min-h-11 rounded-xl" disabled={!dirty || saving} onClick={handleSave}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? "Saving…" : dirty ? "Save changes" : "No changes"}
        </Button>
      </div>
    </div>
  );
}

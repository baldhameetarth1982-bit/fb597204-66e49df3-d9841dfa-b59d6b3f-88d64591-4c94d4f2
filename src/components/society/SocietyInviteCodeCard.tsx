/**
 * Society Invite Code card — used from Society Settings / Business Profile.
 * Admins can view, copy, regenerate, customize, and disable the code.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, RefreshCw, KeyRound, Loader2, Pencil, ToggleLeft, ToggleRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  getSocietyInviteState,
  regenerateSocietyInviteCode,
  setSocietyInviteCodeCustom,
  setSocietyInviteCodeEnabled,
} from "@/lib/society-code";

interface Props {
  societyId: string;
}

export function SocietyInviteCodeCard({ societyId }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [customCode, setCustomCode] = useState("");
  const [busy, setBusy] = useState<null | "regen" | "save" | "toggle">(null);

  const { data, isLoading } = useQuery({
    queryKey: ["society-invite-state", societyId],
    queryFn: () => getSocietyInviteState(societyId),
    enabled: Boolean(societyId),
  });

  async function copy() {
    if (!data?.invite_code) return;
    await navigator.clipboard.writeText(data.invite_code);
    toast.success("Code copied");
  }

  async function regen() {
    setBusy("regen");
    try {
      await regenerateSocietyInviteCode(societyId);
      qc.invalidateQueries({ queryKey: ["society-invite-state", societyId] });
      toast.success("New code generated");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      await setSocietyInviteCodeCustom(societyId, customCode);
      qc.invalidateQueries({ queryKey: ["society-invite-state", societyId] });
      toast.success("Code updated");
      setEditing(false);
      setCustomCode("");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(v: boolean) {
    setBusy("toggle");
    try {
      await setSocietyInviteCodeEnabled(societyId, v);
      qc.invalidateQueries({ queryKey: ["society-invite-state", societyId] });
      toast.success(v ? "Code-based joins enabled" : "Code-based joins paused");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="rounded-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" /> Society invite code
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="py-6 grid place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="rounded-2xl bg-primary/5 border border-primary/15 p-5 text-center">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Current code</p>
              <p className="mt-2 text-3xl font-bold tracking-[0.4em] font-mono text-primary">
                {data?.invite_code ?? "—"}
              </p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Button variant="secondary" size="sm" className="rounded-xl" onClick={copy}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={regen}
                  disabled={busy === "regen"}
                >
                  {busy === "regen" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  )}
                  Regenerate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => {
                    setEditing((v) => !v);
                    setCustomCode(data?.invite_code ?? "");
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Customize
                </Button>
              </div>
            </div>

            {editing && (
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">Custom code</label>
                <Input
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
                  placeholder="e.g. SUNRISE1"
                  className="h-11 rounded-2xl text-center tracking-[0.3em] font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  4–12 letters or numbers. Must be unique across SocioHub.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 rounded-xl"
                    onClick={save}
                    disabled={busy === "save" || customCode.length < 4}
                  >
                    {busy === "save" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Save code
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-medium">
                  {data?.invite_code_enabled ? (
                    <ToggleRight className="h-4 w-4 text-primary" />
                  ) : (
                    <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                  )}
                  Allow joining via code
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Turn off temporarily to pause new residents from requesting access.
                </p>
              </div>
              <Switch
                checked={Boolean(data?.invite_code_enabled)}
                onCheckedChange={toggleEnabled}
                disabled={busy === "toggle"}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

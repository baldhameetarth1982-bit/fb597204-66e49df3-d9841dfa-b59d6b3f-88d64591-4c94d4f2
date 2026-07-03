/**
 * Metadata-driven wizard runner. Steps are pure config — insert / remove / reorder
 * without touching navigation logic. State is autosaved to society_settings.wizard_state
 * every 800ms so refreshes / disconnects never lose progress.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { saveWizardDraft } from "@/lib/hierarchy.functions";
import { toast } from "sonner";

export interface StepProps<S> {
  state: S;
  patch: (p: Partial<S>) => void;
  set: <K extends keyof S>(k: K, v: S[K]) => void;
  goNext: () => void;
  goBack: () => void;
}

export type ValidationResult = { ok: true } | { ok: false; message: string };

export interface WizardStep<S> {
  id: string;
  title: string;
  subtitle?: string;
  progressWeight?: number;
  Component: React.FC<StepProps<S>>;
  validate?: (state: S) => ValidationResult;
  visible?: (state: S) => boolean;
  hideNext?: boolean;
  nextLabel?: string;
}

export interface WizardDef<S> {
  id: string;
  steps: WizardStep<S>[];
  initial: S;
}

interface Props<S> {
  def: WizardDef<S>;
  societyId: string;
  initialState?: Partial<S>;
  onComplete: (state: S) => void | Promise<void>;
  finishLabel?: string;
}

export function WizardRunner<S>({
  def,
  societyId,
  initialState,
  onComplete,
  finishLabel = "Finish setup",
}: Props<S>) {
  const [state, setState] = useState<S>({ ...def.initial, ...(initialState ?? {}) });
  const [stepIdx, setStepIdx] = useState(0);
  const [committing, setCommitting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleSteps = useMemo(
    () => def.steps.filter((s) => (s.visible ? s.visible(state) : true)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def.steps, JSON.stringify(state)],
  );
  const step = visibleSteps[Math.min(stepIdx, visibleSteps.length - 1)];

  const totalWeight = visibleSteps.reduce((a, s) => a + (s.progressWeight ?? 1), 0);
  const doneWeight = visibleSteps
    .slice(0, stepIdx)
    .reduce((a, s) => a + (s.progressWeight ?? 1), 0);
  const progress = Math.round((doneWeight / Math.max(totalWeight, 1)) * 100);

  // Autosave (debounced 800ms)
  useEffect(() => {
    if (!societyId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveWizardDraft(societyId, { step: stepIdx, state } as unknown as Record<string, unknown>).catch(() => {
        /* silent — resume works from last successful save */
      });
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, stepIdx, societyId]);

  const patch = useCallback((p: Partial<S>) => setState((s) => ({ ...s, ...p })), []);
  const set = useCallback(<K extends keyof S>(k: K, v: S[K]) => setState((s) => ({ ...s, [k]: v })), []);

  function goBack() {
    setError(null);
    setStepIdx((i) => Math.max(0, i - 1));
  }

  async function goNext() {
    setError(null);
    if (step?.validate) {
      const v = step.validate(state);
      if (!v.ok) {
        setError(v.message);
        setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 30);
        return;
      }
    }
    if (stepIdx < visibleSteps.length - 1) {
      setStepIdx((i) => i + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setCommitting(true);
    try {
      await onComplete(state);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setCommitting(false);
    }
  }

  if (!step) return null;
  const StepComponent = step.Component;
  const isLast = stepIdx === visibleSteps.length - 1;

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
        <div className="mx-auto max-w-2xl px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 mb-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={stepIdx === 0 || committing}
              onClick={goBack}
              className="h-8 px-2"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-muted-foreground">
                Step {stepIdx + 1} of {visibleSteps.length} · {progress}%
              </p>
              <h1 className="text-base font-semibold tracking-tight truncate">{step.title}</h1>
            </div>
          </div>
          <Progress value={progress} className="h-1.5" />
          {step.subtitle && (
            <p className="mt-2 text-xs text-muted-foreground">{step.subtitle}</p>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-5 pb-32">
          {error && (
            <div
              ref={errorRef}
              className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          <StepComponent state={state} patch={patch} set={set} goNext={goNext} goBack={goBack} />
        </div>
      </main>

      {!step.hideNext && (
        <div className="sticky bottom-0 z-30 border-t bg-background/95 backdrop-blur">
          <div className="mx-auto max-w-2xl px-4 py-3">
            <Button
              onClick={goNext}
              disabled={committing}
              className={cn("w-full h-12 rounded-2xl font-semibold text-base")}
            >
              {committing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isLast ? finishLabel : step.nextLabel ?? "Continue"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

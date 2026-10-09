import { useEffect, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * In-app replacement for the browser's prompt(). `askText` resolves with the
 * typed text, or null when cancelled — the same contract as window.prompt.
 */
type Req = { message: string; defaultValue: string; minLength: number; allowEmpty: boolean; resolve: (v: string | null) => void };
let push: ((r: Req) => void) | null = null;

export function askText(message: string, opts: { defaultValue?: string; minLength?: number; allowEmpty?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    if (!push) { resolve(null); return; }
    push({ message, defaultValue: opts.defaultValue ?? "", minLength: opts.minLength ?? 0, allowEmpty: opts.allowEmpty ?? false, resolve });
  });
}

export function AskTextDialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [value, setValue] = useState("");
  const done = useRef(false);

  useEffect(() => {
    push = (r) => { done.current = false; setValue(r.defaultValue); setReq(r); };
    return () => { push = null; };
  }, []);

  function close(result: string | null) {
    if (!req || done.current) return;
    done.current = true;
    req.resolve(result);
    setReq(null);
  }

  const trimmed = value.trim();
  const tooShort = req ? (!req.allowEmpty && trimmed.length === 0) || (trimmed.length > 0 && trimmed.length < req.minLength) : false;

  return (
    <AlertDialog open={!!req} onOpenChange={(o) => { if (!o) close(null); }}>
      <AlertDialogContent>
        <form onSubmit={(e) => { e.preventDefault(); if (!tooShort) close(value); }} className="space-y-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Please confirm</AlertDialogTitle>
            <AlertDialogDescription>{req?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Textarea autoFocus aria-label={req?.message} value={value} onChange={(e) => setValue(e.target.value)} rows={3} maxLength={500} className="rounded-xl" />
            {req && req.minLength > 0 && <p className="text-xs text-muted-foreground">At least {req.minLength} characters.</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" className="min-h-11 rounded-full">Go back</AlertDialogCancel>
            <Button type="submit" className="min-h-11 rounded-full" disabled={tooShort}>Continue</Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

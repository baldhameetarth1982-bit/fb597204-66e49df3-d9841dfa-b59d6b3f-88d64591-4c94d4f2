import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive, ArchiveRestore, CheckCircle2, ExternalLink, FileText, HelpCircle, Loader2, Lock, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InlineNotice, ListEmpty, ListSkeleton, LoadError, SearchField, SegmentedFilter, StatusChip, SummaryStrip } from "@/components/people/PeopleUI";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  deleteKnowledge, listKnowledgeAdmin, openKnowledgeDocument, saveKnowledgeFaq, setKnowledgeArchived, uploadKnowledgeDocument, type KnowledgeItem,
} from "@/lib/society-knowledge.functions";

export const Route = createFileRoute("/_society/society/knowledge")({
  head: () => ({
    meta: [
      { title: "Documents & FAQs — SociyoHub" },
      { name: "description", content: "Upload society documents and FAQs that AI Secretary can use to answer residents." },
      { property: "og:title", content: "Documents & FAQs — SociyoHub" },
      { property: "og:description", content: "Manage the society knowledge AI Secretary answers from." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KnowledgeAdmin,
});

const STATUS: Record<KnowledgeItem["status"], { label: string; tone: "info" | "success" | "warning" | "neutral" | "muted" }> = {
  processing: { label: "Processing", tone: "info" },
  ready: { label: "Ready for AI", tone: "success" },
  unsupported: { label: "Not readable", tone: "warning" },
  failed: { label: "Failed", tone: "warning" },
  archived: { label: "Archived", tone: "muted" },
};

function fmtSize(n: number | null) {
  if (!n) return "";
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function KnowledgeAdmin() {
  const qc = useQueryClient();
  const list = useServerFn(listKnowledgeAdmin);
  const archiveFn = useServerFn(setKnowledgeArchived);
  const deleteFn = useServerFn(deleteKnowledge);
  const openFn = useServerFn(openKnowledgeDocument);
  const [tab, setTab] = useState<"document" | "faq" | "attention" | "archived">("document");
  const [search, setSearch] = useState("");
  const [uploadFor, setUploadFor] = useState<KnowledgeItem | "new" | null>(null);
  const [faqFor, setFaqFor] = useState<KnowledgeItem | "new" | null>(null);
  const [removing, setRemoving] = useState<KnowledgeItem | null>(null);

  const q = useQuery({ queryKey: ["society-knowledge"], queryFn: () => list(), staleTime: 15_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["society-knowledge"] });

  const archive = useMutation({
    mutationFn: (v: { id: string; archived: boolean }) => archiveFn({ data: v }),
    onSuccess: (r, v) => { if (!r.ok) return toast.error(r.message); toast.success(v.archived ? "Archived — AI Secretary will no longer use it" : "Restored for AI Secretary"); refresh(); },
    onError: () => toast.error("Something went wrong. Please try again."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: (r) => { setRemoving(null); if (!r.ok) return toast.error(r.message); toast.success("Removed"); refresh(); },
    onError: () => toast.error("Something went wrong. Please try again."),
  });

  async function open(id: string) {
    const r = await openFn({ data: { id } }).catch(() => null);
    if (!r?.ok) return toast.error(r?.message ?? "This document isn't available.");
    window.open(r.url, "_blank", "noopener,noreferrer");
  }

  const res = q.data;
  const items = res?.ok ? res.items : [];
  const needle = search.trim().toLowerCase();
  const needsFix = (i: KnowledgeItem) => i.status === "failed" || i.status === "unsupported" || i.status === "processing";
  const inTab = (i: KnowledgeItem) =>
    tab === "archived" ? i.status === "archived"
    : tab === "attention" ? needsFix(i)
    : i.kind === tab && i.status !== "archived";
  const shown = items.filter(inTab).filter((i) => !needle || i.title.toLowerCase().includes(needle) || (i.fileName ?? "").toLowerCase().includes(needle));
  const count = (f: (i: KnowledgeItem) => boolean) => items.filter(f).length;
  const nDocs = count((i) => i.kind === "document" && i.status !== "archived");
  const nFaqs = count((i) => i.kind === "faq" && i.status !== "archived");
  const nFix = count(needsFix);
  const nArch = count((i) => i.status === "archived");
  const ready = count((i) => i.status === "ready");
  const loaded = !!res?.ok;

  return (
    <PageShell>
      <PageHeader
        title="Documents & FAQs"
        description="The society information AI Secretary answers from. Only items marked Ready are used."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setFaqFor("new")} className="min-h-11"><Plus className="h-4 w-4 mr-1.5" /> Add FAQ</Button>
            <Button onClick={() => setUploadFor("new")} className="min-h-11"><Upload className="h-4 w-4 mr-1.5" /> Upload document</Button>
          </div>
        }
      />
      <div className="space-y-4">
        {q.isLoading ? (
          <ListSkeleton rows={4} />
        ) : q.isError || (res && !res.ok) ? (
          res && !res.ok && res.message.includes("Pro") ? (
            <InlineNotice icon={Lock} title="Available on the Pro plan">{res.message}</InlineNotice>
          ) : (
            <LoadError title={res && !res.ok ? res.message : "Couldn't load documents."} onRetry={() => q.refetch()} />
          )
        ) : (
          <>
            <SummaryStrip items={[
              { label: "Ready for AI", value: loaded ? ready : "—" },
              { label: "Documents", value: loaded ? nDocs : "—" },
              { label: "FAQs", value: loaded ? nFaqs : "—" },
              { label: "Need attention", value: loaded ? nFix : "—", hint: "Processing, failed or unreadable" },
            ]} />
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <SegmentedFilter label="Show" value={tab} onChange={setTab} options={[
                { key: "document", label: "Documents", count: nDocs },
                { key: "faq", label: "FAQs", count: nFaqs },
                { key: "attention", label: "Needs attention", count: nFix },
                { key: "archived", label: "Archived", count: nArch },
              ]} />
              <div className="md:w-72"><SearchField value={search} onChange={setSearch} placeholder="Search title or file name" label="Search documents and FAQs" /></div>
            </div>
            {shown.length === 0 ? (
              <ListEmpty icon={tab === "faq" ? HelpCircle : FileText} title={needle ? "No matches" : tab === "archived" ? "Nothing archived" : tab === "attention" ? "Nothing needs attention" : tab === "faq" ? "No FAQs yet" : "No documents yet"}>
                {needle ? `Nothing matches “${search.trim()}”.` : tab === "archived" ? "Archived items stay here and aren't used by AI Secretary." : tab === "attention" ? "Every item has finished processing." : tab === "faq" ? "Add common questions residents ask, with the committee's answer." : "Upload rules, policies or circulars as PDF or text."}
              </ListEmpty>
            ) : (
              <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                {shown.map((i) => {
                  const st = STATUS[i.status];
                  return (
                    <li key={i.id} className={`relative px-4 py-3 ${i.status === "failed" ? "border-l-4 border-l-destructive" : i.status === "unsupported" ? "border-l-4 border-l-warning" : ""}`}>
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                          {i.kind === "faq" ? <HelpCircle className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusChip tone={st.tone}>
                              {i.status === "processing" && <Loader2 className="h-3 w-3 mr-1 motion-safe:animate-spin" />}
                              {i.status === "ready" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                              {st.label}
                            </StatusChip>
                            {i.audience === "committee" && <StatusChip tone="muted"><Lock className="h-3 w-3 mr-1" />Committee only</StatusChip>}
                          </div>
                          <p className="mt-1 font-medium leading-snug break-words">{i.title}</p>
                          <p className="text-xs text-muted-foreground break-all">
                            {[i.kind === "faq" ? "FAQ" : i.fileName, i.kind === "document" ? fmtSize(i.sizeBytes) : null, `Updated ${new Date(i.updatedAt).toLocaleDateString("en-IN")}`].filter(Boolean).join(" · ")}
                          </p>
                          {i.kind === "faq" && i.faqAnswer && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{i.faqAnswer}</p>}
                          {i.statusReason && i.status !== "ready" && <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs">{i.statusReason}</p>}
                          {i.status === "processing" && <p className="mt-1 text-xs text-muted-foreground" role="status">Still processing — not searchable yet. If this stays, upload the file again.</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {i.kind === "document"
                            ? <Button size="sm" variant="outline" className="min-h-11 hidden sm:inline-flex" onClick={() => open(i.id)}><ExternalLink className="h-4 w-4 mr-1" /> View</Button>
                            : <Button size="sm" variant="outline" className="min-h-11 hidden sm:inline-flex" onClick={() => setFaqFor(i)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-11 w-11" aria-label={`More actions for ${i.title}`}><MoreHorizontal className="h-5 w-5" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {i.kind === "document" ? (
                                <>
                                  <DropdownMenuItem className="min-h-11 sm:hidden" onSelect={() => open(i.id)}><ExternalLink className="h-4 w-4 mr-2" /> View</DropdownMenuItem>
                                  <DropdownMenuItem className="min-h-11" onSelect={() => setUploadFor(i)}><RefreshCw className="h-4 w-4 mr-2" /> Replace file</DropdownMenuItem>
                                </>
                              ) : (
                                <DropdownMenuItem className="min-h-11 sm:hidden" onSelect={() => setFaqFor(i)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                              )}
                              {i.status === "ready" && <DropdownMenuItem className="min-h-11" disabled={archive.isPending} onSelect={() => archive.mutate({ id: i.id, archived: true })}><Archive className="h-4 w-4 mr-2" /> Archive</DropdownMenuItem>}
                              {i.status === "archived" && <DropdownMenuItem className="min-h-11" disabled={archive.isPending} onSelect={() => archive.mutate({ id: i.id, archived: false })}><ArchiveRestore className="h-4 w-4 mr-2" /> Restore</DropdownMenuItem>}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => setRemoving(i)}><Trash2 className="h-4 w-4 mr-2" /> Remove…</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {uploadFor && <UploadDialog target={uploadFor} onClose={() => setUploadFor(null)} onDone={refresh} />}
      {faqFor && <FaqDialog target={faqFor} onClose={() => setFaqFor(null)} onDone={refresh} />}
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{removing?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>AI Secretary will stop using it immediately and the file will be deleted. Archive instead if you may need it later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={remove.isPending} onClick={(e) => { e.preventDefault(); if (removing) remove.mutate(removing.id); }}>
              {remove.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function UploadDialog({ target, onClose, onDone }: { target: KnowledgeItem | "new"; onClose: () => void; onDone: () => void }) {
  const upload = useServerFn(uploadKnowledgeDocument);
  const existing = target === "new" ? null : target;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [audience, setAudience] = useState<"residents" | "committee">(existing?.audience ?? "residents");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.set("file", file!);
      fd.set("title", title.trim());
      fd.set("audience", audience);
      if (existing) fd.set("replaceId", existing.id);
      return upload({ data: fd });
    },
    onSuccess: (r) => {
      onDone();
      if (!r.ok) return setError(r.message);
      if (r.status === "ready") { toast.success("Document is ready for AI Secretary"); onClose(); }
      else setError(r.reason ?? "This document couldn't be read.");
    },
    onError: () => setError("Upload failed. Check your connection and try again."),
  });

  function pick(f: File | null) {
    setError(null);
    if (!f) return setFile(null);
    if (!/\.(pdf|txt|md)$/i.test(f.name)) return setError("Only PDF, TXT and Markdown (.md) files are supported.");
    if (f.size > 5 * 1024 * 1024) return setError("Files must be 5 MB or smaller.");
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, 160));
  }

  const valid = !!file && title.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && !m.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Replace document" : "Upload document"}</DialogTitle>
          <DialogDescription>PDF (text-based), TXT or Markdown, up to 5 MB. Scanned images can't be read yet.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="k-title">Title</Label>
            <Input id="k-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Clubhouse booking policy" />
          </div>
          <div className="space-y-1.5">
            <Label>Who can see it</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as typeof audience)}>
              <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="residents">All residents</SelectItem>
                <SelectItem value="committee">Committee only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <input ref={inputRef} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <Button type="button" variant="outline" className="w-full min-h-11 justify-start" onClick={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />{file ? `${file.name} · ${fmtSize(file.size)}` : "Choose file"}
          </Button>
          {existing && <p className="text-xs text-muted-foreground">The old version stops being used as soon as the replacement starts processing.</p>}
          {m.isPending && <p className="text-sm text-muted-foreground flex items-center gap-2" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Uploading and reading text…</p>}
          {error && <p className="text-sm rounded-lg bg-destructive/10 text-destructive px-3 py-2" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={m.isPending}>Cancel</Button>
          <Button onClick={() => { setError(null); m.mutate(); }} disabled={!valid || m.isPending}>{m.isPending ? "Processing…" : existing ? "Replace" : "Upload"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FaqDialog({ target, onClose, onDone }: { target: KnowledgeItem | "new"; onClose: () => void; onDone: () => void }) {
  const save = useServerFn(saveKnowledgeFaq);
  const existing = target === "new" ? null : target;
  const [question, setQuestion] = useState(existing?.title ?? "");
  const [answer, setAnswer] = useState(existing?.faqAnswer ?? "");
  const [audience, setAudience] = useState<"residents" | "committee">(existing?.audience ?? "residents");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => save({ data: { id: existing?.id ?? null, question: question.trim(), answer: answer.trim(), audience } }),
    onSuccess: (r) => { if (!r.ok) return setError(r.message); toast.success("FAQ saved"); onDone(); onClose(); },
    onError: () => setError("Couldn't save. Your text is kept — try again."),
  });
  const valid = question.trim().length >= 3 && answer.trim().length >= 5;
  return (
    <Dialog open onOpenChange={(o) => !o && !m.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit FAQ" : "Add FAQ"}</DialogTitle>
          <DialogDescription>A common question and the official answer residents should get.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="f-q">Question</Label><Input id="f-q" value={question} maxLength={160} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. How do I book the clubhouse?" /></div>
          <div className="space-y-1.5"><Label htmlFor="f-a">Answer</Label><Textarea id="f-a" value={answer} maxLength={4000} rows={6} onChange={(e) => setAnswer(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Who can see it</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as typeof audience)}>
              <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="residents">All residents</SelectItem><SelectItem value="committee">Committee only</SelectItem></SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm rounded-lg bg-destructive/10 text-destructive px-3 py-2" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={m.isPending}>Cancel</Button>
          <Button onClick={() => { setError(null); m.mutate(); }} disabled={!valid || m.isPending}>{m.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

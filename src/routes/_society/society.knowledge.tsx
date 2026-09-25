import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive, ArchiveRestore, CheckCircle2, ExternalLink, FileText, HelpCircle, Loader2, Lock, Pencil, Plus, RefreshCw, Trash2, Upload, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const STATUS: Record<KnowledgeItem["status"], { label: string; cls: string }> = {
  processing: { label: "Processing", cls: "bg-muted text-muted-foreground" },
  ready: { label: "Ready for AI", cls: "bg-primary/10 text-primary" },
  unsupported: { label: "Not readable", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
  archived: { label: "Archived", cls: "bg-muted text-muted-foreground" },
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
  const [tab, setTab] = useState<"all" | "document" | "faq" | "archived">("all");
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
  const shown = items
    .filter((i) => tab === "all" ? i.status !== "archived" : tab === "archived" ? i.status === "archived" : i.kind === tab && i.status !== "archived")
    .filter((i) => !needle || i.title.toLowerCase().includes(needle) || (i.fileName ?? "").toLowerCase().includes(needle));
  const ready = items.filter((i) => i.status === "ready").length;

  return (
    <PageShell>
      <PageHeader title="Documents & FAQs" description="What AI Secretary can use to answer residents. Only items marked Ready for AI are used." />
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setUploadFor("new")} className="min-h-11"><Upload className="h-4 w-4 mr-1.5" /> Upload document</Button>
          <Button variant="outline" onClick={() => setFaqFor("new")} className="min-h-11"><Plus className="h-4 w-4 mr-1.5" /> Add FAQ</Button>
        </div>

        {q.isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        ) : q.isError || (res && !res.ok) ? (
          <Card className="rounded-2xl"><CardContent className="p-6 text-center space-y-3">
            {res && !res.ok && res.message.includes("Pro") ? <Lock className="h-6 w-6 mx-auto text-muted-foreground" /> : <XCircle className="h-6 w-6 mx-auto text-destructive" />}
            <p className="text-sm">{res && !res.ok ? res.message : "Couldn't load documents."}</p>
            <Button variant="outline" onClick={() => q.refetch()} className="min-h-11"><RefreshCw className="h-4 w-4 mr-1.5" /> Try again</Button>
          </CardContent></Card>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{ready} of {items.length} item{items.length === 1 ? "" : "s"} ready for AI Secretary.</p>
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList className="w-full sm:w-auto overflow-x-auto">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="document">Documents</TabsTrigger>
                <TabsTrigger value="faq">FAQs</TabsTrigger>
                <TabsTrigger value="archived">Archived</TabsTrigger>
              </TabsList>
            </Tabs>
            <Input type="search" aria-label="Search documents and FAQs" placeholder="Search by title or file name" value={search} onChange={(e) => setSearch(e.target.value)} className="min-h-11" />
            {shown.length === 0 ? (
              <Card className="rounded-2xl"><CardContent className="p-8 text-center space-y-2">
                <FileText className="h-7 w-7 mx-auto text-muted-foreground" />
                <p className="font-medium">{needle ? "No matches" : tab === "archived" ? "Nothing archived" : "No knowledge yet"}</p>
                <p className="text-sm text-muted-foreground">{tab === "archived" ? "Archived items appear here and aren't used by AI Secretary." : "Upload rules, policies or circulars as PDF or text, or add common questions as FAQs."}</p>
              </CardContent></Card>
            ) : (
              <ul className="space-y-2">
                {shown.map((i) => (
                  <li key={i.id}>
                    <Card className="rounded-2xl"><CardContent className="p-4 space-y-2">
                      <div className="flex items-start gap-3">
                        <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                          {i.kind === "faq" ? <HelpCircle className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium leading-snug break-words">{i.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {i.kind === "faq" ? "FAQ" : [i.fileName, fmtSize(i.sizeBytes)].filter(Boolean).join(" · ")}
                            {" · "}Updated {new Date(i.updatedAt).toLocaleDateString("en-IN")}
                            {i.audience === "committee" ? " · Committee only" : " · Residents"}
                          </p>
                        </div>
                        <Badge variant="secondary" className={STATUS[i.status].cls}>
                          {i.status === "processing" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                          {i.status === "ready" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {STATUS[i.status].label}
                        </Badge>
                      </div>
                      {i.statusReason && i.status !== "ready" && <p className="text-xs rounded-lg bg-muted px-3 py-2">{i.statusReason}</p>}
                      {i.status === "processing" && <p className="text-xs text-muted-foreground">Still processing. It isn't searchable yet — if this stays, upload the file again.</p>}
                      {i.kind === "faq" && i.faqAnswer && <p className="text-sm text-muted-foreground line-clamp-2">{i.faqAnswer}</p>}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {i.kind === "document" && (
                          <>
                            <Button size="sm" variant="ghost" className="min-h-11" onClick={() => open(i.id)}><ExternalLink className="h-4 w-4 mr-1" /> View</Button>
                            <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setUploadFor(i)}><RefreshCw className="h-4 w-4 mr-1" /> Replace</Button>
                          </>
                        )}
                        {i.kind === "faq" && <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setFaqFor(i)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>}
                        {i.status === "ready" && <Button size="sm" variant="ghost" className="min-h-11" disabled={archive.isPending} onClick={() => archive.mutate({ id: i.id, archived: true })}><Archive className="h-4 w-4 mr-1" /> Archive</Button>}
                        {i.status === "archived" && <Button size="sm" variant="ghost" className="min-h-11" disabled={archive.isPending} onClick={() => archive.mutate({ id: i.id, archived: false })}><ArchiveRestore className="h-4 w-4 mr-1" /> Restore</Button>}
                        <Button size="sm" variant="ghost" className="min-h-11 text-destructive" onClick={() => setRemoving(i)}><Trash2 className="h-4 w-4 mr-1" /> Remove</Button>
                      </div>
                    </CardContent></Card>
                  </li>
                ))}
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

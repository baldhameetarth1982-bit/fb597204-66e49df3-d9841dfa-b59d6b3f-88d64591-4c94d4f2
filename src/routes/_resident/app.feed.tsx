import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Heart, MessageCircle, Image as ImageIcon, Loader2, Send, Sparkles, X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { toast } from "sonner";
import { ROLES } from "@/config/roles";
import { ErrorState } from "@/components/system/ErrorState";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, Megaphone, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

function safeMsg(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as any).message) : "";
  if (!m || m.length > 120 || /sql|relation|column|constraint|policy|violat|rpc|function|uuid|stack|\bat\s|jwt|42\d{3}|23\d{3}/i.test(m)) return fallback;
  return m;
}

export const Route = createFileRoute("/_resident/app/feed")({
  head: () => ({
    meta: [
      { title: "Community — SociyoHub" },
      { name: "description", content: "Posts and conversations between residents of your society." },
      { property: "og:title", content: "Community — SociyoHub" },
      { property: "og:description", content: "Posts and conversations between residents of your society." },
    ],
  }),
  component: FeedScreen,
});

interface PostRow {
  id: string;
  body: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
  author_name: string | null;
  author_avatar: string | null;
  reactions: number;
  comments: number;
  liked: boolean;
}

interface DigestRow {
  id: string;
  summary: string;
  week_start: string;
}

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function initials(n?: string | null) {
  return (n ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function FeedScreen() {
  const { user, hasAnyRole } = useAuth();
  // UI hint only — the database only lets Society Admins of the post's society remove others' posts.
  const isSocietyAdmin = hasAnyRole([ROLES.SOCIETY_ADMIN]);
  const { societyId } = useSocietyId();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [digest, setDigest] = useState<DigestRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [likeBusy, setLikeBusy] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PostRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [body, setBody] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!societyId || !user) return;
    setLoading(true);
    setLoadError(false);
    try {
    const [{ data: postRows, error: postsErr }, { data: digestRow }] = await Promise.all([
      supabase
        .from("posts")
        .select("id, body, image_url, created_at, author_id")
        .eq("society_id", societyId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("community_digests")
        .select("id, summary, week_start")
        .eq("society_id", societyId)
        .order("week_start", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (postsErr) throw postsErr;
    setDigest((digestRow as DigestRow) ?? null);

    if (!postRows || postRows.length === 0) {
      setPosts([]);
      setLoading(false);
      return;
    }
    const ids = postRows.map((p) => p.id);
    const authorIds = [...new Set(postRows.map((p) => p.author_id))];
    const [{ data: profs }, { data: rxns, error: rxErr }, { data: cmts, error: cmErr }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, avatar_url").in("id", authorIds),
      supabase.from("post_reactions").select("post_id, user_id").in("post_id", ids),
      supabase.from("post_comments").select("post_id").in("post_id", ids),
    ]);

    if (rxErr || cmErr) throw rxErr ?? cmErr;
    const profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    const rxnCount = new Map<string, number>();
    const liked = new Set<string>();
    (rxns ?? []).forEach((r: any) => {
      rxnCount.set(r.post_id, (rxnCount.get(r.post_id) ?? 0) + 1);
      if (r.user_id === user.id) liked.add(r.post_id);
    });
    const cmtCount = new Map<string, number>();
    (cmts ?? []).forEach((c: any) =>
      cmtCount.set(c.post_id, (cmtCount.get(c.post_id) ?? 0) + 1),
    );

    // Resolve signed URLs for private post images (paths) while keeping legacy http(s) URLs as-is.
    const pathsToSign = postRows
      .map((p) => p.image_url)
      .filter((u): u is string => !!u && !/^https?:\/\//i.test(u));
    const signedMap = new Map<string, string>();
    if (pathsToSign.length > 0) {
      const { data: signed } = await supabase.storage
        .from("posts")
        .createSignedUrls(pathsToSign, 3600);
      (signed ?? []).forEach((s) => {
        if (s.path && s.signedUrl) signedMap.set(s.path, s.signedUrl);
      });
    }

    setPosts(
      postRows.map((p) => {
        const author = profMap.get(p.author_id);
        const resolvedImage = p.image_url
          ? (/^https?:\/\//i.test(p.image_url) ? p.image_url : signedMap.get(p.image_url) ?? null)
          : null;
        return {
          ...p,
          image_url: resolvedImage,
          author_name: author?.full_name ?? null,
          author_avatar: author?.avatar_url ?? null,
          reactions: rxnCount.get(p.id) ?? 0,
          comments: cmtCount.get(p.id) ?? 0,
          liked: liked.has(p.id),
        };
      }),
    );
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [societyId, user?.id]);

  // Realtime
  useEffect(() => {
    if (!societyId) return;
    const ch = supabase
      .channel(`feed-${societyId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts", filter: `society_id=eq.${societyId}` }, () => void load())
      .subscribe();
    return () => void supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [societyId]);

  function pickImage(f: File | null) {
    setImageFile(f);
    if (f) setImagePreview(URL.createObjectURL(f));
    else setImagePreview(null);
  }

  async function submitPost() {
    if (!body.trim() || !user || !societyId || posting) return;
    setPosting(true);
    try {
      let imageUrl: string | null = null;
      if (imageFile) {
        const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        if (!allowed.includes(imageFile.type)) {
          throw new Error("Only JPG, PNG, WEBP, or GIF images are allowed");
        }
        if (imageFile.size > 8 * 1024 * 1024) {
          throw new Error("Image must be under 8MB");
        }
        const extMap: Record<string, string> = {
          "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
        };
        const ext = extMap[imageFile.type];
        const path = `${user.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("posts").upload(path, imageFile, {
          contentType: imageFile.type,
          upsert: false,
        });
        if (upErr) throw upErr;
        // Store the storage path; we sign URLs on read so the bucket can stay private.
        imageUrl = path;
      }
      const { error } = await supabase.from("posts").insert({
        society_id: societyId, author_id: user.id, body: body.trim(), image_url: imageUrl,
      });
      if (error) throw error;
      setBody(""); pickImage(null); if (fileRef.current) fileRef.current.value = "";
      toast.success("Posted");
      void load();
    } catch (e: any) {
      // Keep the typed text and photo so the resident can retry.
      toast.error(safeMsg(e, "Couldn't post. Your message is still here — please try again."));
    } finally {
      setPosting(false);
    }
  }

  async function toggleLike(p: PostRow) {
    if (!user || likeBusy.has(p.id)) return;
    setLikeBusy((s) => new Set(s).add(p.id));
    // optimistic
    setPosts((prev) =>
      prev.map((x) =>
        x.id === p.id
          ? { ...x, liked: !x.liked, reactions: x.reactions + (x.liked ? -1 : 1) }
          : x,
      ),
    );
    const { error } = p.liked
      ? await supabase.from("post_reactions").delete().eq("post_id", p.id).eq("user_id", user.id)
      : await supabase.from("post_reactions").insert({ post_id: p.id, user_id: user.id, kind: "like" });
    if (error) {
      // Roll back the optimistic change.
      setPosts((prev) => prev.map((x) => (x.id === p.id ? { ...x, liked: p.liked, reactions: p.reactions } : x)));
      toast.error("Couldn't update your like. Please try again.");
    }
    setLikeBusy((s) => { const n = new Set(s); n.delete(p.id); return n; });
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    const { data, error } = await supabase.from("posts").delete().eq("id", pendingDelete.id).select("id");
    setDeleting(false);
    if (error || !data || data.length === 0) {
      toast.error("Couldn't remove this post. You don't have permission to remove it.");
    } else {
      setPosts((prev) => prev.filter((x) => x.id !== pendingDelete.id));
      toast.success("Post removed");
    }
    setPendingDelete(null);
  }

  if (!societyId) {
    return (
      <div className="px-5 py-10 text-center text-sm text-muted-foreground">
        Join a society to see the community feed.
      </div>
    );
  }

  const composer = (
    <section aria-label="Write a post" className="rounded-2xl border bg-card p-3">
      <label htmlFor="feed-compose" className="sr-only">Share something with your neighbours</label>
      <Textarea
        id="feed-compose"
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 4000))}
        placeholder="Share something with your neighbours…"
        className="min-h-[72px] resize-none rounded-xl border-0 px-2 focus-visible:ring-0"
      />
      {imagePreview && (
        <div className="relative mt-2 overflow-hidden rounded-xl">
          <img src={imagePreview} alt="Selected photo" className="max-h-64 w-full object-cover" />
          <button type="button" aria-label="Remove photo"
            onClick={() => { pickImage(null); if (fileRef.current) fileRef.current.value = ""; }}
            className="absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-full bg-background/90">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => pickImage(e.target.files?.[0] ?? null)} />
        <Button variant="ghost" onClick={() => fileRef.current?.click()} className="h-11 rounded-xl text-muted-foreground">
          <ImageIcon className="mr-1.5 h-4 w-4" /> Photo
        </Button>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{body.length > 3500 ? `${body.length}/4000` : ""}</span>
        <Button onClick={submitPost} disabled={!body.trim() || posting} className="h-11 rounded-xl px-5">
          {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          <span className="ml-1.5">{posting ? "Posting…" : "Post"}</span>
        </Button>
      </div>
    </section>
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 md:px-8 md:pt-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Community</h1>
        <p className="mt-1 text-sm text-muted-foreground">Conversations between residents of your society</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
          {composer}

          {loading && posts.length === 0 ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading posts">
              {[0, 1, 2].map((i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-muted/60" />)}
            </div>
          ) : loadError ? (
            <ErrorState title="Couldn't load the community feed" description="Check your connection and try again." onRetry={() => void load()} showSupport={false} />
          ) : posts.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
              <MessageCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">No posts yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Start the conversation — say hello to your neighbours.</p>
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Community posts">
              {posts.map((p) => {
                const mine = p.author_id === user?.id;
                const canRemove = mine || isSocietyAdmin;
                return (
                  <li key={p.id}>
                    <article className="overflow-hidden rounded-2xl border bg-card">
                      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 pt-4">
                        <Avatar className="h-10 w-10 shrink-0">
                          {p.author_avatar && <AvatarImage src={p.author_avatar} alt="" />}
                          <AvatarFallback className="bg-primary/10 text-xs text-primary">{initials(p.author_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{p.author_name ?? "Resident"}{mine && <span className="font-normal text-muted-foreground"> · you</span>}</p>
                          <p className="text-xs text-muted-foreground">Resident post · {timeAgo(p.created_at)}</p>
                        </div>
                        {canRemove && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-11 w-11 rounded-xl text-muted-foreground" aria-label="Post options">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => setPendingDelete(p)}>
                                <Trash2 className="mr-2 h-4 w-4" />{mine ? "Remove my post" : "Remove post (committee)"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </header>
                      <p className="whitespace-pre-line break-words px-4 pt-3 text-[15px] leading-relaxed">{p.body}</p>
                      {p.image_url && <img src={p.image_url} alt="Photo shared with the post" loading="lazy" className="mt-3 max-h-96 w-full object-cover" />}
                      <footer className="mt-2 grid grid-cols-2 border-t">
                        <button type="button" onClick={() => toggleLike(p)} disabled={likeBusy.has(p.id)} aria-pressed={p.liked}
                          aria-label={`${p.liked ? "Unlike" : "Like"}${p.reactions ? `, ${p.reactions} likes` : ""}`}
                          className={`flex min-h-12 items-center justify-center gap-2 text-sm font-medium transition-colors hover:bg-muted/60 ${p.liked ? "text-destructive" : "text-muted-foreground"}`}>
                          <Heart className={`h-4 w-4 ${p.liked ? "fill-current" : ""}`} />{p.reactions ? p.reactions : "Like"}
                        </button>
                        <Link to="/app/feed/$postId" params={{ postId: p.id }}
                          className="flex min-h-12 items-center justify-center gap-2 border-l text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60">
                          <MessageCircle className="h-4 w-4" />{p.comments ? `${p.comments} comment${p.comments === 1 ? "" : "s"}` : "Comment"}
                        </Link>
                      </footer>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="order-first space-y-3 lg:order-none" aria-label="From your committee">
          <Link to="/app/notices" className="flex min-h-14 items-center gap-3 rounded-2xl border border-primary/30 bg-primary-container px-4 py-3 text-primary-container-foreground transition-colors hover:opacity-90">
            <Megaphone className="h-5 w-5 shrink-0" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="block font-semibold">Official notices</span>
              <span className="block opacity-80">Committee announcements live separately from resident posts.</span>
            </span>
          </Link>
          {digest && (
            <section className="rounded-2xl border bg-card p-4">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="h-4 w-4 text-primary" /> Weekly digest
                <span className="ml-auto font-normal normal-case">{new Date(digest.week_start).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
              </p>
              <p className="text-sm leading-relaxed whitespace-pre-line line-clamp-6 lg:line-clamp-none">{digest.summary}</p>
              <p className="mt-2 text-xs text-muted-foreground">AI summary of recent posts — may miss details.</p>
            </section>
          )}
        </aside>
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && !deleting && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete && pendingDelete.author_id !== user?.id ? "Remove this resident's post?" : "Remove this post?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && pendingDelete.author_id !== user?.id
                ? "As a Society Admin you can remove posts that break your society's rules. "
                : ""}
              It will disappear from the community feed for everyone, along with its comments. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void confirmDelete(); }} disabled={deleting}>
              {deleting ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

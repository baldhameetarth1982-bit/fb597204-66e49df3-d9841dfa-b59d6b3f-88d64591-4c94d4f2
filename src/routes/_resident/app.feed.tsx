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
import { Trash2, Megaphone } from "lucide-react";

function safeMsg(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as any).message) : "";
  if (!m || m.length > 120 || /sql|relation|column|constraint|policy|violat|rpc|function|uuid|stack|\bat\s|jwt|42\d{3}|23\d{3}/i.test(m)) return fallback;
  return m;
}

export const Route = createFileRoute("/_resident/app/feed")({
  head: () => ({ meta: [{ title: "Community Feed — SociyoHub" }] }),
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

  return (
    <div className="px-4 py-5 space-y-4 pb-24">
      <header className="px-1">
        <h1 className="text-2xl font-semibold tracking-tight">Community</h1>
        <p className="text-sm text-muted-foreground">Posts shared by residents of your society</p>
      </header>

      <Link
        to="/app/notices"
        className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 min-h-[52px] hover:bg-muted/50 transition-colors"
      >
        <Megaphone className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm flex-1 min-w-0">
          <span className="font-medium">Official notices</span>
          <span className="text-muted-foreground"> from your committee are on the Notices page.</span>
        </span>
      </Link>

      {digest && (
        <Card className="rounded-2xl border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wide">
                AI Community Digest
              </span>
              <Badge variant="secondary" className="ml-auto rounded-full text-[10px]">
                Week of {new Date(digest.week_start).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </Badge>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-line">{digest.summary}</p>
          </CardContent>
        </Card>
      )}

      {/* Composer */}
      <Card className="rounded-2xl">
        <CardContent className="p-3 space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 4000))}
            placeholder="Share something with your neighbors…"
            className="rounded-xl resize-none min-h-[64px] border-0 focus-visible:ring-0 px-2"
          />
          {imagePreview && (
            <div className="relative rounded-xl overflow-hidden">
              <img src={imagePreview} alt="" className="w-full max-h-64 object-cover" />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => { pickImage(null); if (fileRef.current) fileRef.current.value = ""; }}
                className="absolute top-2 right-2 h-9 w-9 rounded-full bg-background/90 grid place-items-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="flex items-center justify-between pt-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              hidden
              onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileRef.current?.click()}
              className="rounded-xl text-muted-foreground"
            >
              <ImageIcon className="h-4 w-4 mr-1" /> Photo
            </Button>
            <Button
              onClick={submitPost}
              disabled={!body.trim() || posting}
              className="rounded-xl"
              size="sm"
            >
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span className="ml-1.5">Post</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading && posts.length === 0 ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading posts">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 rounded-2xl bg-muted/60 animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <ErrorState
          title="Couldn't load the community feed"
          description="Check your connection and try again."
          onRetry={() => void load()}
          showSupport={false}
        />
      ) : posts.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No posts yet. Be the first to share!
        </div>
      ) : (
        posts.map((p) => (
          <Card key={p.id} className="rounded-2xl overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-2">
                <Avatar className="h-10 w-10">
                  {p.author_avatar && <AvatarImage src={p.author_avatar} />}
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    {initials(p.author_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">
                    {p.author_name ?? "Resident"}
                    {p.author_id === user?.id && <span className="text-muted-foreground font-normal"> (you)</span>}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{timeAgo(p.created_at)}</p>
                </div>
                {(p.author_id === user?.id || isSocietyAdmin) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={p.author_id === user?.id ? "Remove your post" : "Remove post (committee)"}
                    onClick={() => setPendingDelete(p)}
                    className="h-10 w-10 rounded-xl text-muted-foreground shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-line break-words">{p.body}</p>
              {p.image_url && (
                <img
                  src={p.image_url}
                  alt=""
                  loading="lazy"
                  className="mt-3 -mx-4 max-h-80 w-[calc(100%+2rem)] object-cover"
                />
              )}
              <div className="mt-3 flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleLike(p)}
                  disabled={likeBusy.has(p.id)}
                  aria-pressed={p.liked}
                  aria-label={p.liked ? "Unlike" : "Like"}
                  className={`rounded-xl ${p.liked ? "text-red-500" : "text-muted-foreground"}`}
                >
                  <Heart className={`h-4 w-4 mr-1 ${p.liked ? "fill-current" : ""}`} />
                  {p.reactions || ""}
                </Button>
                <Button asChild variant="ghost" size="sm" className="rounded-xl text-muted-foreground">
                  <Link to="/app/feed/$postId" params={{ postId: p.id }}>
                    <MessageCircle className="h-4 w-4 mr-1" />
                    {p.comments || "Comment"}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}

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

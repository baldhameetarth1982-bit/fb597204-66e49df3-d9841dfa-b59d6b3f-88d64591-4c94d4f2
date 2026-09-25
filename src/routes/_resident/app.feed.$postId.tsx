import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Send, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { ROLES } from "@/config/roles";
import { ErrorState } from "@/components/system/ErrorState";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_resident/app/feed/$postId")({
  head: () => ({ meta: [{ title: "Post — SociyoHub" }] }),
  component: PostThread,
});

interface PostDetail {
  id: string; body: string; image_url: string | null; created_at: string;
  author_id: string; author_name: string | null; author_avatar: string | null;
}
interface Comment {
  id: string; body: string; created_at: string; user_id: string;
  author_name: string | null; author_avatar: string | null;
}

const MAX_COMMENT = 2000;

function initials(n?: string | null) {
  return (n ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function PostThread() {
  const { postId } = useParams({ from: "/_resident/app/feed/$postId" });
  const navigate = useNavigate();
  const { user, hasAnyRole } = useAuth();
  // UI hint only — the database only lets Society Admins of this post's society remove it.
  const isSocietyAdmin = hasAnyRole([ROLES.SOCIETY_ADMIN]);
  const [post, setPost] = useState<PostDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingComment, setPendingComment] = useState<Comment | null>(null);
  const [pendingPostDelete, setPendingPostDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setLoadError(false);
    try {
      const [{ data: p, error: pErr }, { data: cs, error: cErr }] = await Promise.all([
        supabase.from("posts").select("id, body, image_url, created_at, author_id").eq("id", postId).maybeSingle(),
        supabase.from("post_comments").select("id, body, created_at, user_id").eq("post_id", postId).order("created_at"),
      ]);
      if (pErr || cErr) throw pErr ?? cErr;
      if (!p) { setPost(null); setLoading(false); return; }
      const userIds = [...new Set([p.author_id, ...((cs ?? []).map((c) => c.user_id))])];
      const { data: profs } = await supabase.from("profiles").select("id, full_name, avatar_url").in("id", userIds);
      const pm = new Map((profs ?? []).map((x: any) => [x.id, x]));
      // Post images are stored privately as paths; sign them for display (legacy full URLs kept as-is).
      let image: string | null = null;
      if (p.image_url) {
        if (/^https?:\/\//i.test(p.image_url)) image = p.image_url;
        else {
          const { data: signed } = await supabase.storage.from("posts").createSignedUrl(p.image_url, 3600);
          image = signed?.signedUrl ?? null;
        }
      }
      setPost({
        ...p,
        image_url: image,
        author_name: pm.get(p.author_id)?.full_name ?? null,
        author_avatar: pm.get(p.author_id)?.avatar_url ?? null,
      });
      setComments((cs ?? []).map((c) => ({
        ...c,
        author_name: pm.get(c.user_id)?.full_name ?? null,
        author_avatar: pm.get(c.user_id)?.avatar_url ?? null,
      })));
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [postId]);

  async function send() {
    const body = text.trim();
    if (!body || !user || sending) return;
    if (body.length > MAX_COMMENT) { toast.error("Comments can be up to 2,000 characters."); return; }
    setSending(true);
    // Author is always the signed-in user; the database rejects any other user_id or a post outside your society.
    const { error } = await supabase.from("post_comments").insert({ post_id: postId, user_id: user.id, body });
    setSending(false);
    if (error) {
      // Keep the typed text so it can be retried.
      toast.error("Couldn't add your comment. Your text is still here — please try again.");
      return;
    }
    setText("");
    void load(true);
  }

  async function confirmDeleteComment() {
    if (!pendingComment || deleting) return;
    setDeleting(true);
    const { data, error } = await supabase.from("post_comments").delete().eq("id", pendingComment.id).select("id");
    setDeleting(false);
    if (error || !data || data.length === 0) {
      toast.error("Couldn't remove this comment. You can only remove your own comments.");
    } else {
      setComments((prev) => prev.filter((c) => c.id !== pendingComment.id));
      toast.success("Comment removed");
    }
    setPendingComment(null);
  }

  async function confirmDeletePost() {
    if (!post || deleting) return;
    setDeleting(true);
    const { data, error } = await supabase.from("posts").delete().eq("id", post.id).select("id");
    setDeleting(false);
    setPendingPostDelete(false);
    if (error || !data || data.length === 0) {
      toast.error("Couldn't remove this post. You don't have permission to remove it.");
      return;
    }
    toast.success("Post removed");
    void navigate({ to: "/app/feed" });
  }

  const back = (
    <Link to="/app/feed" className="inline-flex items-center text-sm text-muted-foreground min-h-[44px]">
      <ArrowLeft className="h-4 w-4 mr-1" /> Back to Community
    </Link>
  );

  if (loading) {
    return (
      <div className="px-4 py-4 space-y-3" aria-busy="true" aria-label="Loading post">
        {back}
        <div className="h-40 rounded-2xl bg-muted/60 animate-pulse" />
        <div className="h-16 rounded-2xl bg-muted/60 animate-pulse" />
        <div className="h-16 rounded-2xl bg-muted/60 animate-pulse" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="px-4 py-4 space-y-3">
        {back}
        <ErrorState title="Couldn't load this post" description="Check your connection and try again." onRetry={() => void load()} showSupport={false} />
      </div>
    );
  }
  if (!post) {
    return (
      <div className="px-4 py-4 space-y-3">
        {back}
        <p className="py-10 text-center text-sm text-muted-foreground">
          This post isn't available. It may have been removed.
        </p>
      </div>
    );
  }

  const isOwnPost = post.author_id === user?.id;
  const canRemovePost = isOwnPost || isSocietyAdmin;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-[calc(200px+env(safe-area-inset-bottom))] md:px-8 md:pb-40">
      {back}

      {/* 1. Post context */}
      <article aria-label="Post" className="mt-3 overflow-hidden rounded-2xl border bg-card">
        <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 pt-4">
          <Avatar className="h-10 w-10 shrink-0">
            {post.author_avatar && <AvatarImage src={post.author_avatar} alt="" />}
            <AvatarFallback className="bg-primary/10 text-xs text-primary">{initials(post.author_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{post.author_name ?? "Resident"}{isOwnPost && <span className="font-normal text-muted-foreground"> · you</span>}</p>
            <p className="text-xs text-muted-foreground">Resident post · {fmtDate(post.created_at)}</p>
          </div>
          {canRemovePost && (
            <Button variant="ghost" className="h-11 rounded-xl text-muted-foreground" aria-label={isOwnPost ? "Remove your post" : "Remove post (committee)"} onClick={() => setPendingPostDelete(true)}>
              <Trash2 className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">{isOwnPost ? "Remove" : "Moderate"}</span>
            </Button>
          )}
        </header>
        <p className="whitespace-pre-line break-words px-4 pb-4 pt-3 text-[15px] leading-relaxed">{post.body}</p>
        {post.image_url && <img src={post.image_url} alt="Photo shared with the post" loading="lazy" className="max-h-96 w-full object-cover" />}
      </article>

      {/* 2. Conversation */}
      <section aria-labelledby="comments-h" className="mt-6">
        <h2 id="comments-h" className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Conversation <span className="rounded-full bg-muted px-1.5 tabular-nums">{comments.length}</span>
        </h2>
        {comments.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card px-6 py-8 text-center">
            <p className="text-sm font-medium">No comments yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Be the first to reply below.</p>
          </div>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {comments.map((c) => {
              const mine = c.user_id === user?.id;
              return (
                <li key={c.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 px-4 py-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    {c.author_avatar && <AvatarImage src={c.author_avatar} alt="" />}
                    <AvatarFallback className="bg-primary/10 text-[10px] text-primary">{initials(c.author_name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="truncate font-semibold">{c.author_name ?? "Resident"}{mine && <span className="font-normal text-muted-foreground"> · you</span>}</span>
                      <span className="text-xs text-muted-foreground">{fmtDate(c.created_at)}</span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-line break-words text-sm leading-relaxed">{c.body}</p>
                  </div>
                  {mine && (
                    <Button variant="ghost" size="icon" aria-label="Remove your comment" onClick={() => setPendingComment(c)} className="-mr-2 h-11 w-11 rounded-xl text-muted-foreground">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 3. Write a comment — pinned above the bottom nav, aligned to the conversation column */}
      <div className="fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-20 border-t bg-background/95 backdrop-blur md:bottom-0">
        <div className="mx-auto w-full max-w-2xl px-4 py-3 md:px-8">
          <div className="flex items-end gap-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_COMMENT))}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }}
              placeholder="Write a comment…"
              aria-label="Write a comment"
              className="max-h-40 min-h-[44px] resize-none rounded-xl"
            />
            <Button onClick={send} disabled={!text.trim() || sending} aria-label="Send comment" className="h-11 shrink-0 rounded-xl px-4">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Send</span></>}
            </Button>
          </div>
          <p className="mt-1 text-right text-xs text-muted-foreground tabular-nums">{text.length > MAX_COMMENT - 200 ? `${text.length}/${MAX_COMMENT}` : " "}</p>
        </div>
      </div>


      <AlertDialog open={!!pendingComment} onOpenChange={(o) => !o && !deleting && setPendingComment(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove your comment?</AlertDialogTitle>
            <AlertDialogDescription>It will disappear for everyone. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void confirmDeleteComment(); }} disabled={deleting}>
              {deleting ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingPostDelete} onOpenChange={(o) => !o && !deleting && setPendingPostDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isOwnPost ? "Remove this post?" : "Remove this resident's post?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isOwnPost
                ? "It will disappear from the community feed for everyone, along with its comments. This can't be undone."
                : "As a Society Admin you can remove posts that break your society's rules. It will disappear from the community feed for everyone, along with its comments. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void confirmDeletePost(); }} disabled={deleting}>
              {deleting ? "Removing…" : "Remove post"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

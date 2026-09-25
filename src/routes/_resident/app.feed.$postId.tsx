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
    <div className="px-4 py-4 space-y-4 pb-[calc(176px+env(safe-area-inset-bottom))]">
      {back}

      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 mb-2">
            <Avatar className="h-10 w-10">
              {post.author_avatar && <AvatarImage src={post.author_avatar} />}
              <AvatarFallback className="bg-primary/10 text-primary text-xs">{initials(post.author_name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm truncate">
                {post.author_name ?? "Resident"}
                {isOwnPost && <span className="text-muted-foreground font-normal"> (you)</span>}
              </p>
              <p className="text-[11px] text-muted-foreground">{fmtDate(post.created_at)}</p>
            </div>
            {canRemovePost && (
              <Button
                variant="ghost" size="icon"
                aria-label={isOwnPost ? "Remove your post" : "Remove post (committee)"}
                onClick={() => setPendingPostDelete(true)}
                className="h-10 w-10 rounded-xl text-muted-foreground shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-line break-words">{post.body}</p>
          {post.image_url && (
            <img src={post.image_url} alt="" loading="lazy" className="mt-3 -mx-4 max-h-96 w-[calc(100%+2rem)] object-cover" />
          )}
        </CardContent>
      </Card>

      <h2 className="px-1 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Comments ({comments.length})
      </h2>
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No comments yet. Start the conversation.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id}>
              <Card className="rounded-2xl">
                <CardContent className="p-3 flex gap-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    {c.author_avatar && <AvatarImage src={c.author_avatar} />}
                    <AvatarFallback className="bg-primary/10 text-primary text-[10px]">{initials(c.author_name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold truncate">
                        {c.author_name ?? "Resident"}
                        {c.user_id === user?.id && <span className="text-muted-foreground font-normal"> (you)</span>}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{fmtDate(c.created_at)}</p>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-line break-words">{c.body}</p>
                  </div>
                  {c.user_id === user?.id && (
                    <Button
                      variant="ghost" size="icon" aria-label="Remove your comment"
                      onClick={() => setPendingComment(c)}
                      className="h-10 w-10 rounded-xl text-muted-foreground shrink-0 -mr-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <div className="fixed bottom-[calc(68px+env(safe-area-inset-bottom))] inset-x-0 mx-auto w-full max-w-[420px] border-t bg-background p-3">
        <div className="flex gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_COMMENT))}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }}
            placeholder="Add a comment…"
            aria-label="Write a comment"
            className="rounded-xl min-h-[44px] resize-none"
          />
          <Button onClick={send} disabled={!text.trim() || sending} aria-label="Send comment" className="rounded-xl shrink-0 h-11 w-11 p-0">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        {text.length > MAX_COMMENT - 200 && (
          <p className="text-[11px] text-muted-foreground mt-1 text-right">{text.length}/{MAX_COMMENT}</p>
        )}
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

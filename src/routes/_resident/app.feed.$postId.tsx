import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export const Route = createFileRoute("/_resident/app/feed/$postId")({
  head: () => ({ meta: [{ title: "Post — SocioHub" }] }),
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

function initials(n?: string | null) {
  return (n ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function PostThread() {
  const { postId } = useParams({ from: "/_resident/app/feed/$postId" });
  const { user } = useAuth();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: p }, { data: cs }] = await Promise.all([
      supabase.from("posts").select("id, body, image_url, created_at, author_id").eq("id", postId).maybeSingle(),
      supabase.from("post_comments").select("id, body, created_at, user_id").eq("post_id", postId).order("created_at"),
    ]);
    if (!p) { setLoading(false); return; }
    const userIds = [...new Set([(p as any).author_id, ...((cs ?? []).map((c: any) => c.user_id))])];
    const { data: profs } = await supabase.from("profiles").select("id, full_name, avatar_url").in("id", userIds);
    const pm = new Map((profs ?? []).map((x: any) => [x.id, x]));
    setPost({
      ...(p as any),
      author_name: pm.get((p as any).author_id)?.full_name ?? null,
      author_avatar: pm.get((p as any).author_id)?.avatar_url ?? null,
    });
    setComments((cs ?? []).map((c: any) => ({
      ...c,
      author_name: pm.get(c.user_id)?.full_name ?? null,
      author_avatar: pm.get(c.user_id)?.avatar_url ?? null,
    })));
    setLoading(false);
  }

  useEffect(() => { void load(); }, [postId]);

  async function send() {
    if (!text.trim() || !user) return;
    setSending(true);
    const { error } = await supabase.from("post_comments").insert({
      post_id: postId, user_id: user.id, body: text.trim(),
    });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    setText("");
    void load();
  }

  if (loading) {
    return <div className="py-16 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>;
  }
  if (!post) {
    return <div className="px-5 py-10 text-center text-sm text-muted-foreground">Post not found</div>;
  }

  return (
    <div className="px-4 py-4 space-y-4 pb-32">
      <Link to="/app/feed" className="inline-flex items-center text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Link>

      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 mb-2">
            <Avatar className="h-10 w-10">
              {post.author_avatar && <AvatarImage src={post.author_avatar} />}
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                {initials(post.author_name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold text-sm">{post.author_name ?? "Resident"}</p>
              <p className="text-[11px] text-muted-foreground">{new Date(post.created_at).toLocaleString()}</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-line">{post.body}</p>
          {post.image_url && <img src={post.image_url} alt="" className="mt-3 -mx-4 max-h-96 w-[calc(100%+2rem)] object-cover" />}
        </CardContent>
      </Card>

      <h2 className="px-1 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Comments ({comments.length})
      </h2>
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Start the conversation</p>
      ) : (
        <div className="space-y-2">
          {comments.map((c) => (
            <Card key={c.id} className="rounded-2xl">
              <CardContent className="p-3 flex gap-3">
                <Avatar className="h-8 w-8">
                  {c.author_avatar && <AvatarImage src={c.author_avatar} />}
                  <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                    {initials(c.author_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{c.author_name ?? "Resident"}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-line">{c.body}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="fixed bottom-[68px] inset-x-0 mx-auto w-full max-w-[420px] border-t bg-background p-3 flex gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 2000))}
          placeholder="Add a comment…"
          className="rounded-xl min-h-[44px] resize-none"
        />
        <Button onClick={send} disabled={!text.trim() || sending} className="rounded-xl shrink-0">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

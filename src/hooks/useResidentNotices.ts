import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { NoticeRow } from "@/lib/notices";

export function useResidentNotices() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["resident-notices", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      // RLS returns only live notices meant for this resident's home.
      const [n, r, a] = await Promise.all([
        supabase.from("notices").select("id, title, body, category, audience, block_id, status, publish_at, published_at, created_at, edited_at, priority, expires_at, requires_ack")
          .eq("status", "published").order("publish_at", { ascending: false }).limit(100),
        supabase.from("notice_reads").select("notice_id"),
        supabase.from("notice_acks").select("notice_id"),
      ]);
      if (n.error) throw n.error;
      return { notices: (n.data ?? []) as NoticeRow[], read: new Set((r.data ?? []).map((x) => x.notice_id as string)), acked: new Set((a.data ?? []).map((x) => x.notice_id as string)) };
    },
  });
}

export async function markNoticeRead(noticeId: string, userId: string) {
  await supabase.from("notice_reads").upsert({ notice_id: noticeId, user_id: userId }, { onConflict: "notice_id,user_id", ignoreDuplicates: true });
}

export async function acknowledgeNotice(noticeId: string) {
  const { error } = await supabase.rpc("notice_acknowledge", { _id: noticeId });
  if (error) throw error;
}

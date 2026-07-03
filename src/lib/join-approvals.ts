import { supabase } from "@/integrations/supabase/client";

export interface PendingJoinRequest {
  id: string;
  user_id: string;
  full_name: string | null;
  mobile: string | null;
  flat_number_input: string | null;
  owner_or_tenant: string | null;
  created_at: string;
  requester_email: string | null;
}

export async function listPendingJoinRequests(societyId: string): Promise<PendingJoinRequest[]> {
  const { data, error } = await supabase.rpc("list_pending_join_requests", {
    _society_id: societyId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as PendingJoinRequest[];
}

export async function bulkApproveJoinRequests(societyId: string, ids: string[] | null) {
  const { data, error } = await supabase.rpc("bulk_approve_join_requests", {
    _society_id: societyId,
    _request_ids: ids as any,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function bulkRejectJoinRequests(societyId: string, ids: string[], reason: string | null) {
  const { data, error } = await supabase.rpc("bulk_reject_join_requests", {
    _society_id: societyId,
    _request_ids: ids as any,
    _reason: reason as any,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

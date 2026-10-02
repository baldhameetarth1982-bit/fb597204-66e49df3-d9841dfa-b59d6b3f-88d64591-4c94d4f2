import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ParkingSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ViolationReportForm } from "./ParkingAdmin";

/** Guard-side: report a parking violation. Needs a live gate session (enforced server-side). */
export function GuardParkingCard({ societyId }: { societyId: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const slots = useQuery({
    queryKey: ["guard-parking-slots", societyId],
    enabled: !!societyId && open,
    queryFn: async () => {
      const { data, error } = await supabase.from("parking_slots").select("id, label").eq("society_id", societyId!).eq("is_active", true).order("label");
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <>
      <Button variant="outline" className="min-h-11 w-full justify-start rounded-xl" onClick={() => setOpen(true)}>
        <ParkingSquare className="mr-2 h-4 w-4" />Report a parking violation
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader><SheetTitle>Parking violation</SheetTitle></SheetHeader>
          <div className="py-4">
            {slots.isError ? <p role="alert" className="text-sm">Couldn't load slots. You can still report by number plate.</p> : null}
            <ViolationReportForm slots={slots.data ?? []} onDone={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

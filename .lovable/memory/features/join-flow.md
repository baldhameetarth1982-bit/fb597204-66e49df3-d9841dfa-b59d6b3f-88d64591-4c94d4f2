---
name: Join Society Flow
description: Flat-based join request with admin approval
type: feature
---
Flow: Login → Join Society → Search Society → Select Society → Select Flat → Choose Owner/Tenant → Submit Request → Pending Approval screen → Society Admin Approves → Resident permanently linked to that flat.
One resident, one society. Flat link is fixed unless an admin reassigns.
Implementation: `join_requests` table (society_id, flat_id, user_id, relationship, status pending/approved/rejected, reviewer, reason). RPCs `request_join_flat` and `respond_join_request`. Admin approval triggers `flat_residents` insert + `profiles.society_id` set via privileged path (society-change flag).
Residents in pending state stay on `/onboarding/pending` until approved.

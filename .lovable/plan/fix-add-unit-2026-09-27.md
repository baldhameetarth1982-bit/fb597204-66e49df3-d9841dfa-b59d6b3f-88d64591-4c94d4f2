# Fix Add Unit

## What will change
- Expand the saved unit-type validation to accept the unit layouts already offered by the form, such as 1BHK, 2BHK, and Penthouse.
- Keep existing unit categories valid so current records and billing behavior remain compatible.
- Show a clear retryable message if unit creation fails instead of leaving the dialog without useful feedback.
- Add focused regression coverage and verify the build.

## Safety
- Keep society-admin authorization and society isolation unchanged.
- Do not inspect or alter any society records.
- Do not touch `src/lib/utils.ts`.

## Technical details
- Apply an additive-compatible database validation update through the managed migration flow.
- Reuse the existing unit-creation action and UI; no new data path or permission system.

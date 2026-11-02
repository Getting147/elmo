# Read-only task focus regression

Run `report-task-focus.spec.ts` only against the isolated B12 Mock backend
(`backend_b12.py` in the B12 handover) and the seeded local ALPHA account.
Set `BASELINE_FOCUS_FIXTURE_URL` to that backend's loopback URL and `BASE_URL`
to the test Web server. Set `BASELINE_FOCUS_SNAPSHOT` to JSON containing the saved
fixture snapshot's `snapshot_id`, `content_sha256` and `question_count`.
The spec is skipped without explicit fixture opt-in.
Use a Playwright config without the general E2E global setup, since this
fixture has its own synthetic account and database.

The test checks initial restoration and repeated same-run viewing for collection,
analysis and report stages. It checks the actual title against the sticky header
and hit-tests the title, rather than treating an on-screen section box as proof
that its heading is unobscured. It also checks read-only call counts, target-run
identity, unsaved edits, and that passive polling does not reclaim scrolling.

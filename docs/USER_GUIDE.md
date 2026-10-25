# User guide

## Start with a scan

Open **Settings & Scan Status**. A bounded scan reads at most 100 records from
each collector and is the quickest permission and connectivity check. A
complete scan paginates through visible records up to the documented
10,000-record cap per collector and performs dependency analysis.

Keep the browser tab open while a scan runs. If any collector is incomplete,
the scan and every page retain a visible warning. The app does not substitute
sample data for missing results.

A complete baseline remains in use after a bounded or incomplete check; the
scan banner explains when it is being retained. Cancel stops further collection
without replacing that baseline. Private objects are excluded from the shared
hygiene inventory. Your assigned hygiene role determines whether collection
and review controls are available.

## Collect usage evidence

After an inventory scan, choose a 30, 90, or 180-day window in **Settings &
Scan Status** and select **Collect usage evidence**. The app runs bounded,
on-demand searches against the saved-search audit trail and Splunk Web access
log visible to the signed-in user.

Usage collection records only derived counts, last-observed timestamps, source
coverage, and provenance in `ch_usage_evidence`. Raw user SPL and actor lists
are not persisted. The customer object is never executed, changed, disabled, or
deleted by this workflow.

Each telemetry source is capped at 10,000 attributable rows and a 140-second
interactive request budget. Reaching either guardrail produces incomplete
coverage rather than a silent conclusion.

Every supported object receives one of these evidence states:

- **Activity observed** — attributable executions or dashboard accesses were
  found.
- **No activity, complete window** — source records span the requested window
  and no attributable activity was found. This supports investigation but is
  not proof that the object is unused.
- **Partial window** — visible telemetry does not span the requested period.
- **Unavailable** — the source was empty, inaccessible, or the search failed.
- **Not measured** — no applicable usage run exists for the object.
- **Historical** — the inventory differs, the object changed after the window,
  or the window ended more than seven days ago. Counts remain context, not
  current decision evidence.
- **Unsupported** — this resource type has no directly attributable telemetry
  source; it is not reported as unused.

Only a complete current window with zero observations can increase abandonment
confidence. Observed activity can lower abandonment confidence. Partial,
unavailable, stale, or post-modification evidence never produces an inactivity
classification.

## Understand the status groups

- **Active**: current evidence does not identify a hygiene concern.
- **Dormant**: available evidence suggests review, but usage telemetry is not
  yet sufficient for an automated removal conclusion.
- **Orphaned**: dependency or ownership evidence suggests an object is no longer
  connected as expected.
- **Broken**: a supported explicit reference could not be resolved in the
  visible, complete catalog.
- **Unowned**: ownership evidence requires review.
- **Protected**: the object should not be treated as a routine cleanup
  candidate.
- **Unknown**: permissions, catalog completeness, or missing evidence prevent a
  defensible classification.

These are investigation aids, not deletion instructions.

## Environment Overview

The **Live inventory by app** tile includes every app in the latest live
snapshot. Search by app name, sort by app name, object count, or any displayed
health percentage, reverse the sort direction, and choose 5, 10, or 25 rows per
page.

Select a health-composition bar to see exact counts and percentages for that
app. Select the app name or **View app candidates** to open Cleanup Candidates
with the app filter applied. Pagination and sorting change only the Overview
presentation; exports continue to include the complete live app summary.

## Cleanup Candidates

Filter by health group, usage-evidence state, app, object type, free text, or
Review Library stage.
Open an object to inspect identity, ownership, reference counts, reasons, and
suggested next steps. Exports include the full filtered result set, not just the
current page.

Selecting a row opens a full-width workspace. **Explore dependencies** is in the
object header, above its evidence. Use **Back to candidates** to return to the
same filters and results page, or Previous/Next to move through the filtered
results. A link to a known inventory object opens that exact object even when it
is outside the cleanup-candidate filters; the workspace labels that context.

Use the **Review decision** tab to store a stage, investigation note, and optional
assignee. Evidence, decision editing, and revision history have their own tabs.
The underlying Splunk object is not changed.

### Bulk candidate review

Select rows, **Select all on this page**, or **Select all N filtered results**.
Paging and sorting preserve selection; changing a filter or scan clears it.
Choose **Review N selected**, enter a stage, optional shared note and assignee,
then preview the exact identities, type counts and proposed saves/skips before
confirming. Selection alone never saves a decision.

Existing reviews are skipped by default, including archived decisions. Explicit
active-review updates append the shared note, preserve an assignee left blank,
and never silently reaffirm an earlier evidence baseline. Archived or unverifiable
histories must be handled individually. Each new review captures available current
evidence using the same policy as an individual save; missing evidence stays
unverifiable. A shared decision is not removal approval.

Saves are sequential, conflict checked, and not atomic. **Stop after current item**
leaves completed saves intact and reports the remainder as not saved. Conflicts,
unconfirmed saves, failures and skips remain distinct in the CSV/JSON receipt.
Authentication failures or unconfirmed writes stop further saves. Retry only
explicit failed items after recheck; inspect conflicts and unconfirmed outcomes
individually. The result receipt includes each saved revision, actor and time.
There is no persistent app-wide rule: newly discovered objects are not retained
automatically by an earlier batch.

## In-use and required content

Open **In-use Content** from navigation or Overview. The default starting set is
current attributable dashboard/saved-search activity plus active **Retain** review
decisions. Choose activity kinds and whether saved-search activity must include a
successful execution. Scheduled and manual saved-search runs cannot be separated
by the available telemetry. Failed/skipped attempts are disclosed, not called
successful runs. Historical, modified or expired observations are not silently
reused as current activity.

Retain remains a human decision, not proof of usage. The report records the
reviewer, review date and evidence status, and still includes a retained identity
whose current definition is no longer visible with an explicit missing-definition
warning. Archived or unverifiable persisted decisions are not accepted as roots.
**Retained content report** in Review Library starts with Retain decisions only.

Use **Explicitly selected objects** to choose one or more exact starting identities
without claiming usage. **Required content report** on an Explorer center opens
that identity directly. The picker shows 200 matches; refine its search to reach
other objects. Missing identities are disclosed, not replaced with a default.

The report follows all supported outbound dependency hops, including macro,
lookup and lookup-file chains, deduplicates identities, and handles cycles. App
containment/ownership links are metadata, not required-content closure. Retaining
an App object does not imply retaining every object in that app. Groups and display
filters help browse the result; filtering a type/app does not alter the underlying
closure. Each required row has one shortest witness path, with conservative path
confidence. Inspect it or drill into Explorer to investigate further.

Tables show 50 rows at a time. Only path presentation is bounded to 100 identities;
the complete supported closure is still calculated. A 50,000-object or
250,000-relationship traversal ceiling produces an explicit **Truncated** warning.
Full JSON preserves parameters, root reasons, witness parents, all traversed
relationships, the usage run/window and source summaries, and coverage diagnostics.
Mapping and source warnings remain visible even when telemetry covers the complete
requested window; complete time coverage does not mean every activity row maps to
an object. Object CSV is grouped by type and uses
compact parent/root IDs; export coverage CSV alongside it. A filtered CSV is
explicitly labeled and is not the full dependency footprint.

This is always a **partial shared static footprint**, not a complete migration
manifest. Review the listed gaps: event types, tags, field extractions/aliases,
calculated fields, transforms, workflow actions, navigation menus, automatic
lookups and implicit props.conf dependencies are not inventoried/resolved. Private,
dynamic, external and ad-hoc consumers may require more content. Missing activity
or absence from this list never establishes inactivity or removal eligibility.

## Dependency Explorer

Choose a center object to see inbound and outbound relationships. Each edge
shows direction, relation, confidence, resolution state, source location, and
evidence.

Filters can restrict the center objects and related results by cleanup group or
Review Library stage. Select a resolved related object to continue the
investigation as a multi-step drill-through. Cross-view links preserve the
selected object context.

The **Relationships** tab puts consumers on the left and dependencies on the
right. Inspect a card to update its details without changing the center. Use
**Center on this object** or table **Drill in** to continue the path. High-degree
relationships group by app or type; expand groups in batches of twelve or
choose individual objects. Zoom, fit the center, and scroll/keyboard-pan inside
the contained map. The map discloses represented and omitted counts; the
paginated evidence table and full filtered exports remain available. The center
picker shows up to 200 matches; refine its search to reach any other object.
Filters and the reset action remain available even when a group is empty.

A supplied object link never falls back to another graph center. While inventory
loads its exact identity is retained. If the object is outside the center group,
**Show requested object** broadens that group explicitly. If it is unavailable,
the page keeps the identity visible and disables center-specific investigation
actions until a valid center is chosen. Missing inventory is not proof of deletion.
Links from Candidates, Library, and Ownership carry their originating scan ID;
a notice identifies when Explorer is using a different inventory snapshot.
Related-object filters never silently change a requested center.

The map and evidence tables use the full workspace width. Inspecting a graph
card or relationship opens **Selected object**, with its identity and actions at
the top. **Review decision** applies to that inspected object; its title names
the object explicitly. **Review center object** instead selects the graph center
for review. Switching tabs preserves an in-progress review draft.

**Export investigation** separates filtered relationship CSV/JSON from the full,
unfiltered removal-impact CSV/JSON. View filters never reduce impact calculations.

### Impact of removal

In the **Removal impact** tab, **Impact of removal** analyzes the complete
unfiltered relationship snapshot even when the visible graph is filtered. Its
depth control follows known dependents for one, two, three, or five hops.

The simulation reports:

- direct consumers whose captured reference would be broken;
- indirect consumers reachable through a cascading dependency path;
- affected app namespaces and protected or unresolved blockers;
- the exact path, relation, confidence, evidence, and likely outcome for every
  affected object;
- dependencies that may have no other known consumer after the selected object
  is retired; and
- an ordered validation, owner-confirmation, remediation, rollback, controlled
  change, and post-change verification plan.

Impact readiness is intentionally conservative. Protected content,
retain/blocked review decisions, partial scans, collector warnings, unresolved
targets, traversal limits, known direct dependents, observed recent activity,
and absent or incomplete current usage windows prevent an eligible result. Even
an eligible result means only that captured graph and observation prerequisites
are satisfied; it is not authorization or proof of safety.

Use the impact CSV for an affected-object register and the JSON report for the
complete analysis, consequences, caveats, follow-ups, and recommended sequence.
The application never performs the removal.

The **Changes since review** tab compares the selected object's full captured
direct neighborhood with its explicitly saved evidence baseline. Definition,
owner/sharing/ACL, relationship confidence, and adjacent-object configuration
changes are explained independently of graph filters. Filter center or related
groups by review-evidence status to focus an investigation. Drill from changed
relationships into the current object; unavailable targets cannot be centered.
Impact calculations continue to use the full current graph, not the change list.

## Review Library

The Review Library is durable app-local workflow state:

- **Triage** — saved for initial review and prioritization.
- **Investigating** — dependency, usage, or ownership evidence is under review.
- **Awaiting owner** — an owner or subject-matter expert must confirm intent.
- **Confirmed eligible** — evidence supports eligibility for a separate future
  cleanup process.
- **Retain** — the object was reviewed and should remain.
- **Blocked** — missing evidence, policy, or a dependency prevents a decision.

Select a record to open its full-width workspace. **Explore dependencies** and
**View candidate evidence** sit beside the object title. **Review decision** is
the default tab; **Evidence & changes**, **Object & usage details**, and
**Revision history** keep supporting material readable without a narrow sidebar
or an independent scrolling pane. Back/Previous/Next retain the list's filters.
Exports clearly distinguish the filtered Library from the selected review.

Review records retain an object identity snapshot and scan provenance even if
the object is not visible in the latest scan. Creating a review snapshots the
current usage coverage, observation count, last-observed time, and usage-run
identifier. Later note/stage edits retain those original at-review facts.
**Archive library record** asks for confirmation and archives only the active app-local entry. Select
**Archived** or **All** in the Library state filter to inspect it and restore the
preserved decision. Customer content is never archived or removed by this action.

### Concurrent edits and history

Switching evidence/history tabs keeps your draft in place. Changing objects,
following an investigation link, or leaving the app asks you to keep editing or
explicitly discard unsaved changes. Nothing is automatically saved or merged.
Browser reload/close uses the browser's own unsaved-change prompt. Save form
edits before capturing/reaffirming evidence or archiving the record.

Each editor starts from the revision it loaded. If someone saves first, your
draft is retained and Save is blocked. Select **Compare with latest saved review**,
read the saved stage/note/assignee alongside your draft, then either use the saved
values or select **Save reconciled draft**. A later collision repeats this check;
there is no blind overwrite option. An uncertain network response must be
reloaded before retrying.

**Show saved revisions** loads revision history on demand. **Load older
revisions** fetches another page. History exports contain only loaded revisions,
not an implied full archive. New revision names and timestamps are recorded by
the authenticated server coordinator; this is application history, not a
tamper-proof audit. Legacy records are retained
separately and their first new edit starts journal history.

### What changed since I reviewed this?

The saved stage is your decision; **Review evidence** is a separate derived status:

- **Current** — a recent comparable scan has complete supported shared static coverage and its
  returned configuration, access, and parsed direct relationships match the
  evidence baseline. This is not live verification or permission to remove.
- **Needs re-review** — a known configuration, access, coverage, relationship,
  adjacent-object, or attributable-usage change warrants investigation. Any
  remaining coverage limits are also shown.
- **Cannot verify** — the object is no longer observed, no supported baseline
  exists, fingerprints are unavailable, or coverage/freshness cannot establish
  validity. No longer observed does not mean deleted.

Use the Library evidence-status filter or its summary buttons to work through
these groups. CSV/JSON exports include status, reasons, limits, and scan provenance.
The change panel offers its own filtered CSV and full evidence JSON exports.
Tables are paginated; exports include all matching rows, not just the visible page.

The coverage panel separates returned configuration, returned ACL, outbound
references, and potential inbound references. Read the reason and possible-source
examples for each partial or unavailable dimension. Open a possible source to
investigate it; it is not automatically a confirmed dependency. Dynamic names,
default index scope, unknown runtime commands, private sources, or unmodeled
external callers can leave a dimension partial. Library/Explorer exports retain
the policy and coverage details. A supported object can be Current even when an
unrelated part of the full scan is partial; removal-impact planning still retains
all of its broader blockers.

New records capture a recent fingerprint when available. Existing reviews are
never silently migrated to Current. After reviewing the evidence, save any form
edits, then choose **Capture review evidence** or **Reaffirm review evidence**.
This explicit action retains the saved stage, note, assignee, original at-review
facts, and first-capture history. Reaffirming partial evidence does not make its
coverage complete. A changed/unverifiable confirmation cannot satisfy removal
planning prerequisites. Retain/blocked decisions remain blockers regardless of
evidence status.

Configuration fingerprints are hashes, not raw definitions. Runtime counters,
collection times, scan IDs, JSON property ordering, and ACL role ordering do not
invalidate a review. The complete direct adjacency is fingerprinted; durable
manifests retain at most 200 relationship rows per object. If a neighborhood is
larger, the app can detect a changed full fingerprint but explicitly limits exact
row comparisons rather than inventing added/lost relationships. First and recent
prior baselines survive rolling inventory retention.

These checks cover only returned configuration and supported parsed references.
Lookup contents, external callers, filesystem scripts, and unsupported dynamic
references need separate investigation. Run a complete scan after upgrading to
establish fingerprints; old scans remain readable but cannot verify new reviews.

## Ownership

Use ownership summaries to find content associated with missing, disabled,
shared, or unknown owners. Drill into an app or object in the other views before
making a decision. Global or app sharing is not automatically an ownership
defect.

## Reporting

Overview, candidates, dependency relationships, review records, ownership, and
scan status expose CSV and/or JSON export controls. Exports are generated in
the browser from the current live snapshot and active filters. Candidate,
dependency, review, environment, and scan exports include applicable usage
coverage and observations. Review exported files before sharing because object
names, apps, owners, notes, and evidence may be sensitive.
Object evidence exports include validity and observation-window provenance.
CSV strings that could execute as spreadsheet formulas are neutralized; JSON
retains original strings.

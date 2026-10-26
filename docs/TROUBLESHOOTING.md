# Troubleshooting

## Bulk review skips objects or stops partway through

Existing decisions are skipped by default. Archived/unverifiable histories are
never restored in bulk. To change an active review, explicitly choose that option
and inspect the preview; notes append and blank assignees preserve earlier values.
A too-long combined note fails rather than truncating the earlier rationale.

Each item is rechecked against the revision confirmed in the preview. A changed
decision becomes a conflict, not an overwrite. The batch is not atomic: earlier
confirmed saves remain. Cancellation, permission failures, inventory changes and
unconfirmed responses stop further writes. Export the per-object results. Inspect
unconfirmed/conflicting reviews individually before deciding whether to save again;
the app does not automatically replay an uncertain write.

## The required-content report is empty or incomplete

Check the current inventory and usage window. A new inventory can make earlier
usage historical; collect a fresh bounded usage window to obtain current roots.
Zero observed roots is not proof of inactivity. Include active Retain decisions or
explicitly select exact starting objects for a dependency-only investigation.

Display filters narrow the table, not the closure. Choose the full JSON export
for all supported identities, relationships and diagnostics; export coverage CSV
alongside object CSV. From 1.1.1, a type/app selection no longer present in a
settled footprint resets to **All** with a status notice; still-valid filters and
search text remain. Use **Clear display filters** if a valid but narrow
combination hides the rows you need. This never changes the starting set or
underlying dependency traversal.

A source-scan change notice, unresolved/missing definition,
partial outbound manifest or traversal ceiling is an explicit limitation. The
report includes bounded potential automatic lookup links, not full implicit
props closure, every knowledge-object type, private/dynamic content, ad-hoc usage
or external consumers, and is not a
complete migration manifest.

## Automatic lookup links are missing or marked potential

Run a complete scan after upgrading to 1.2, then inspect **Automatic lookup rules
(props)** in the scan report. An older cached scan has no new catalog; a failed,
denied or capped collector does not establish absence. An established complete
baseline stays visible after an incomplete check. Use existing authorized read
access; do not grant customer-content write access or weaken private-object ACLs.

Choose the exact Automatic Lookup identity and namespace in Explorer. Literal
rule-to-definition bindings are distinct from possible callers. Only positive
exact original-event selectors are matched: patterns, negative filters, broad
searches, non-event generators, transformed fields and post-process queries do
not establish an exact scope. Macro/data-model caller namespaces, props
precedence, renames, field availability and other implicit props remain unverified.
Exported rules may have different possible definition targets by invoking app.
See the [investigation workflow](USER_GUIDE.md#automatic-lookups-and-implicit-props).

Potential status is deliberate and propagates through downstream report paths;
it is not a collector error or evidence of actual execution. Missing from the
map is never proof that a rule or lookup can be removed. Review source diagnostics
for the 250-links-per-source/50,000-per-scan matching ceilings. New evidence can
change review validity without altering the saved decision or its baseline.

## A dependency link cannot show its requested object

Version 1.0.2 preserves the requested identity rather than opening an unrelated
fallback object. If the object exists but is outside the center group, select
**Show requested object** to broaden that group explicitly. Relationship
filters remain separate from the center request.

If the identity is unavailable, inspect scan coverage and the scanning user's
visibility, or choose a different center. Missing from the current shared
inventory does not prove that the object was deleted. A source-scan notice
means the originating page and Explorer used different inventory snapshots;
the original identity is retained for investigation.

Reports, Alerts, and Saved Searches use the same canonical `saved_search::`
identity. Do not rename objects or rewrite review KV records to repair a link.
New links encode spaces as `%20` and literal plus signs as `%2B`. An older link
whose spaces already became literal plus signs is ambiguous: reopen the object
from Candidates or select its exact current identity in Explorer. The app does
not guess by replacing plus signs, which could select another real object.
Exact Report targeting and reload, including names containing spaces, have been
validated on the 10.2.5 minimum runtime. If a valid Report still opens incorrectly,
report the app version, object type, scan transition, and sanitized reproduction
steps. Do not publish customer identities. See the
[compatibility policy](COMPATIBILITY.md) for the tested matrix and support boundary.

## Invalid review endpoint max_content_length setting

Version 1.0.2 declares `max_content_length = 4 MiB` in the app's `restmap.conf`.
Earlier packages used a bare byte count, which can produce HTTPRestDispatcher
configuration errors. Upgrade the package and coordinate a Splunk restart if
required to activate REST configuration. Do not change the server-wide body
limit or weaken review permissions. The coordinator also enforces its own
4 MiB UTF-8 payload limit before inserting a journal revision.

## Selected-object workspace and unsaved changes

From 1.0.1 onward, selected objects open in a full-width workspace rather than
a narrow right-side detail tile. Use **Back to review library**, **Back to
candidates**, or **Back to ownership inventory** to return to the retained list
filters and pagination. Dependency inspection has its own **Selected object**
tab and does not move the graph center unless you choose a centering action.

Evidence and history tabs do not reset a review draft. If navigation is blocked
by unsaved changes, choose **Keep editing** and save the note/stage/reviewer, or
explicitly discard the draft. The app does not autosave. A browser reload/close
uses the browser's own warning. Archive and evidence-capture controls require
form edits to be saved first.

Export actions are grouped in labeled menus. Check the menu item's scope:
filtered results, selected object/review/owner, full impact, or loaded history.
The export format does not change that scope.

If you still see the older sidebar after upgrading, refresh that app tab. Do
not refresh a tab containing unsaved work until the draft has been saved or
copied to a safe location.

Use the displayed scan, coverage, and review messages before changing permissions
or data. This app never needs customer-content write access to investigate an
object. Preserve existing decisions and take a supported KV backup before any
administrative repair.

## No inventory or incomplete scans

Run a bounded scan from **Settings & Scan Status**, inspect the collector warning,
and check the initiating user's existing REST capabilities. Then run a complete
scan. Keep its browser tab open. A complete collector is capped at 10,000 visible
records; a cap or failed page is disclosed, not interpreted as object absence.
An established baseline can remain visible after an incomplete check; the banner
identifies retained evidence. An abandoned app-local scan lock expires after
30 minutes. Do not clear a lock while its browser is still collecting.

## Cannot verify or Needs re-review

These are evidence states, not lost decisions. Inspect **Changes since review**
and all four coverage dimensions. An absent object means no longer observed,
not proven deleted. Legacy or differently normalized evidence requires a fresh
complete scan and explicit reaffirmation after review. Save stage/note/assignee
edits first; reaffirmation cannot change them at the same time. Reaffirming partial
coverage does not make it complete. Evidence older than seven days, scan errors,
and missing history cannot establish Current.

If a dynamic reference is shown as a possible source, inspect the actual source
and namespace. It is not an asserted dependency. Private-source details remain
excluded. A Current static review never proves absence of hidden or external use
and does not bypass removal-impact readiness checks.

## A save conflicts

Keep the tab open: the unsaved draft is retained. Select **Compare with latest
saved review**, compare all three editable fields, and choose the saved values
or **Save reconciled draft**. The reconciled save still checks the latest revision.
If the response was uncertain, reload the saved review before retrying. The app
does not automatically replay writes or offer an unconditional overwrite.

## Review storage or permissions fail

Check KV Store health and the installed app version. Reviewers and operators need
the named hygiene role and write permission to `ch_review_revisions`; viewers must
not be granted that write permission. Legacy `ch_reviews` stays read-only to the
app. Inspect `metadata/local.meta` for overrides through normal administrative
change control. Do not restore legacy writes as a workaround.

If the coordinator is unavailable, verify the installed Python handler,
`restmap.conf`/`web.conf`, the `content_hygiene_review` capability, and write
permission for the Splunk service account under
`$SPLUNK_HOME/var/run/splunk/content_hygiene/`. Use a standalone POSIX search head;
clustered and Windows coordinated writes are unsupported in 1.0. A busy save
returns a retry message after a bounded lock wait. Reload before retrying; do
not bypass the coordinator or delete an active lock file.

If the message reports a missing/inconsistent revision or evidence reference,
stop editing and preserve both collections. Restore a consistent supported KV
backup with your Splunk administrator. Deleting a bad row or rebuilding the scan
cannot repair journal continuity safely.

If an original legacy decision changed outside the journal, export/preserve both
versions and involve the decision owners. The app blocks writes because it cannot
choose which decision is authoritative. There is no automatic reconciliation or
safe blind overwrite. Close older editing tabs and resolve the origin/journal
through a backed-up, reviewed administrative recovery procedure.

## An archived review seems missing

Select **Archived** or **All** in Review Library. Restore the retained decision
from its editor. **Show saved revisions** exposes accepted changes; history exports
include only pages already loaded. A Library report is not a backup. Back up
`ch_reviews` and `ch_review_revisions` together and do not prune individual revisions.

## Usage does not establish inactivity

Verify existing search access to `_audit` and `_internal`, retention, requested
window, row caps, and the source warnings. Zero observations from partial,
unavailable, historical, or expired telemetry never mean unused. Usage evidence
cannot authorize cleanup.

## Theme or native icon issues

Use Splunk's native appearance preference and reload the app. The workspace
follows the signed-in user's light/dark preference. See [Branding](BRANDING.md)
for native launcher placements and asset-cache diagnosis. Do not change global
template, security, or cache settings merely to repair a workspace issue.

When reporting an issue, include app/Splunk versions, browser, view, theme,
sanitized steps, and the relevant warning. Do not publish tokens, hosts, raw
customer definitions, review notes, or unredacted screenshots. See
[Support](../SUPPORT.md) and [Security](../SECURITY.md).

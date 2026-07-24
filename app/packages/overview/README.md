# Content Hygiene UI

Shared React implementation for Overview, Cleanup Candidates, Dependency
Explorer, Review Library, Ownership, and Settings. Production pages read live
Splunk KV Store inventory only. The sole interactive write path is the
app-local `ch_reviews` workflow collection; customer knowledge objects remain
read-only.

Licensed under the MIT License.

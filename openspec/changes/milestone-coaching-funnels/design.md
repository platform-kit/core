# Design

## Context

See the proposal. The existing email runner enrolls a person once per funnel, while support chat steps are browser prompts rather than messages. Neither identifies a particular session or course milestone. Native bookings record a primary host and can have additional hosts; Cal.com webhook ingestion currently records an organizer and payload. Course enrollments and lesson progress have completion timestamps.

## Goals / Non-Goals

**Goals:** Preserve the existing funnels and message surfaces; use one provider-neutral sender decision and a durable, inspectable schedule for each occurrence.

**Non-Goals:** A generic workflow engine, other external schedulers, cross-site content, or a change to marketing email opt-outs. Do not equate the primary organizer with an assigned coach in a multi-organizer booking.

## Decisions

1. **Milestones are occurrences, not audience membership.** Store a stable source identity, recipient, occurred time, matched funnel and a snapshot of its steps and sender. A distinct delivery per step gives repeat sessions independent schedules and makes edits non-retroactive. Unlike reusing the email log, it does not suppress later bookings. Avoid backfilling before publication.
2. **Normalize scheduling evidence at ingestion.** Preserve the booking type, scheduled end, individually assigned person, and full organizer set with provenance for native and Cal.com. Cal.com's `MEETING_ENDED` is emitted at the scheduled end rather than the actual call end; neither it nor the scheduled time proves attendance. Exclude cancellations and known no-shows before delivery. Resolve identities against local accounts; explicitly record unknown or ambiguous evidence. For Cal.com, use its signed events and documented booking/event-type API where necessary, and verify real round-robin with fixed hosts and collective cases before relying on any field. Never infer assignment solely from list order or the primary host. A test double supplements, not replaces, that check.
3. **Use course-owned completion.** Consume enrollment and lesson progress, and produce section completion once when its last required lesson finishes. Snapshot the matching milestone even when courses or section definitions later change. Choose the authorized sender in the funnel editor because course completion has no booking organizer.
4. **Deliver through coaching conversations.** A scheduled, transactional/idempotent operation creates the message and marks its delivery together, with concurrency control and explicit failures. A five-minute worker finds due work, rechecks booking cancellation and no-show status, and leaves incomplete or failed work visible for retry. Preserve existing notification, unread, and access behavior; display that the message was automated. Do not send as a coach the author is not authorized to use.
5. **Editor and content.** Keep authored text and labels in editable content, use selectors for the booking types, course hierarchy and authorized sender, and use one structured delay field per step. Existing prompt and email steps retain their meanings. The delivery view shows status and reason. No new motion is required; inspect authoring, validation, preview and status in both themes at desktop and mobile widths.
6. **Respect module ownership.** Funnel-owned orchestration joins sessions, courses and coaching through module integrations; absent modules do not leave invalid schema references. Role grants and row security are declared with the owning schema.

## Risks / Trade-offs

- [Cal.com data may not distinguish an assigned host from multiple organizers] → Test documented API and real provider data; surface an unresolved sender rather than inventing one. Do not claim parity until the required scenarios pass.
- [A scheduled end does not prove attendance or actual call completion] → Explain this limitation, exclude known no-shows and do not backfill existing bookings.
- [Existing bookings may lack reliable assignment evidence] → Show missing evidence for new eligible occurrences rather than guessing a sender.
- [A coach is removed or permissions change after scheduling] → Revalidate authorization and sender at delivery, holding the message with an actionable reason.
- [Concurrent workers or a crash could duplicate chat messages] → Make message insertion and delivery marking atomic with a unique occurrence/step identity; exercise real concurrent runs.
- [Recipients may treat automation as personal correspondence] → Identify automated messages in the conversation and limit creation and inspection to authorized staff.

## Migration Plan

Add declarative schema and explicit grants, compile new funnel definitions alongside existing ones, and deploy the worker and compatible editors together. Do not start historical sequences. Rolling back disables new triggers and workers while retaining delivery records and messages for audit; existing email funnels and support prompts continue unchanged.

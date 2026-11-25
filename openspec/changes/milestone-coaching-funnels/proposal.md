# Proposal

## Why

Coaches cannot arrange a sequence of coaching messages around a client's completed session or course progress. The current funnel's support prompts and once-per-person email steps do not deliver this experience.

## What Changes

- Let an authorized coach create a coaching-message funnel for selected booking types or a specific course, section, or lesson milestone, with editable message steps and delays.
- After a booking's scheduled end, send from the coach assigned to that booking; if nobody is assigned, use its sole organizer. Apply the same rule to native and Cal.com bookings. Cal.com's meeting-ended event is scheduled and does not prove attendance or the actual time a call ended.
- For course milestones, let the funnel author select the sending coach explicitly. This is a proposed default because a course has no session organizer.
- Track each qualifying milestone separately, prevent duplicate sends, and expose pending, sent, and failed deliveries without changing existing email funnels or support prompts.
- Exclude cancelled and no-show bookings; preserve the distinction between an assigned coach and an organizer.

The funnel editor will use the labels “Coaching message”, “Session completed”, “Course completed”, “Section completed”, “Lesson completed”, “Booking type”, “Send as”, and “After milestone” to identify the new controls. Message bodies remain site-authored content.

## Capabilities

### New Capabilities

- `milestone-coaching-funnels`: Milestone-triggered coaching messages, sender selection, scheduling, and delivery.

### Modified Capabilities

None.

## Impact

The funnel editor and content compiler, native and Cal.com booking ingestion, course progress, coaching chat, background delivery, admin visibility, module boundaries, and the documentation site are affected. Review sender attribution, permissions, repeat sessions, retries, and the real external-booking flow. The change does not add other scheduling providers, alter existing marketing email policy, or impersonate an uncertain sender.

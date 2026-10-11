---
scope: emails
---

## order

### mail

subject: Your order — {{title}}

## shipped

### mail

subject: Your copy of {{title}} has shipped

## files

### mail

subject: Your files are ready — {{title}}

## chat

### mail

subject: {{name}} sent you a message

## support

### mail

subject: {{name}} replied to your message
voice-line: sent you a voice note
file-line: sent you a file
received: Thanks — your message is in. The next available person will reply as soon as they can.

## support-digest

### mail

subject: {{count}} waiting on support
waiting: waiting {span}

## magic-link

### mail

subject: Confirm your email address

## recovery

### mail

subject: Choose a new password

## invitation

### mail

subject: Invitation to schedule social posts

## campaign

### mail

subject: {{subject}}

## unsubscribe

### page

title: You will not hear from us again
body: That address is off every list. The emails about an order you place — a confirmation, a parcel on its way — still come, since they are about the order and nothing else.
bad-title: That link did not work
bad-body: It may have been cut short by the mail client. Sign in and write to us, and we will take the address off by hand.
back: Back to the site

## push

### space-mention

title: {name} in #{channel}
body: {body}
url: /spaces/{channel_id}

### space-mention-sealed

title: {name} in #{channel}
body: A message you cannot read from here. Open the room.
url: /spaces/{channel_id}

### support-new

title: New support conversation
body: {name}: {body}
url: /admin/support/{conversation_id}

### support-message

title: New support message
body: {name}: {body}
url: /admin/support/{conversation_id}

### users

title: New account
body: {name} just signed up ({email})
url: /admin

### purchases

title: New purchase
body: {sku} — {amount} from {email}
url: /admin

### subscriptions

title: New membership
body: {sku} — {amount} — {email}
url: /admin

### bookings

title: Session booked
body: {name} · {title} · {when}
url: /admin

### test

title: Notifications are on
body: This is what one looks like. You can turn any of them off on the Notifications page.
url: /admin/notifications

## provider-terms

### mail

subject: New terms to agree to before your next sale

## event-reminder

### mail

subject: {{what}} is {{in}}

## session-held

### mail

subject: That time is held — {{title}}, {{when}}

## session-to-confirm

### mail

subject: Someone is waiting on you — {{title}}, {{when}}

## session-declined

### mail

subject: That one could not happen — {{title}}, {{when}}

## session-booked

### mail

subject: Your session is booked — {{title}}, {{when}}

## session-moved

### mail

subject: Your session has moved — {{title}}, now {{when}}

## session-cancelled

### mail

subject: Your session on {{when}} is cancelled

## session-reminder

### mail

subject: Your session is {{in}} — {{title}}

## session

### place

where-video: A video call on the site
where-link: Online: {url}
where-place: In person at {name}, {address}
where-phone: By phone: {number}
where-phone-theirs: By phone — the host calls you
in-hours: in {n} hours
in-hour: in an hour
in-minutes: in {n} minutes

## funnel

### editor

goal: Goal
goal-help: The page somebody reaching means the email worked, e.g. /store
goal-placeholder: /store
analytics: Analytics

## policy

### recordings

label: Keep a call's recording for
unit: days · 0 keeps them forever

### reminders

label: Remind before a session
unit: hours before
add: Add a reminder
none: No reminders are sent.

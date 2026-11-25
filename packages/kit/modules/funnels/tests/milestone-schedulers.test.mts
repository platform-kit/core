import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calWebhookPayload, calWebhookTime, isFlatMeetingWebhook } from '../../../supabase/functions/_shared/cal-webhook-event.js'

test('flat Cal.com meeting events use the booking and scheduled meeting time', () => {
  const event = {
    triggerEvent: 'MEETING_ENDED',
    uid: 'booking',
    createdAt: '2026-01-01T00:00:00Z',
    startTime: '2026-02-01T10:00:00Z',
    endTime: '2026-02-01T11:00:00Z',
    user: { email: 'coach@example.test' },
  }
  assert.equal(isFlatMeetingWebhook(event), true)
  assert.equal(calWebhookPayload(event), event)
  assert.equal(calWebhookTime(event), Date.parse(event.endTime))
  assert.equal(calWebhookTime({ ...event, triggerEvent: 'MEETING_STARTED' }), Date.parse(event.startTime))
  assert.ok(Number.isNaN(calWebhookTime({ ...event, endTime: undefined })))
})

test('nested Cal.com events keep their payload and delivery timestamp', () => {
  const payload = { uid: 'booking' }
  const event = { triggerEvent: 'BOOKING_CREATED', createdAt: '2026-02-01T10:00:00Z', payload }
  assert.equal(isFlatMeetingWebhook(event), false)
  assert.equal(calWebhookPayload(event), payload)
  assert.equal(calWebhookTime(event), Date.parse(event.createdAt))
})

type CalWebhookEvent = {
  triggerEvent?: string
  payload?: Record<string, any> | null
  createdAt?: string
  startTime?: string
  endTime?: string
} & Record<string, any>

const flatMeeting = (event: CalWebhookEvent) =>
  event.payload == null && (event.triggerEvent === 'MEETING_STARTED' || event.triggerEvent === 'MEETING_ENDED')

export function calWebhookPayload(event: CalWebhookEvent) {
  return flatMeeting(event) ? event : event.payload ?? {}
}

export function calWebhookTime(event: CalWebhookEvent) {
  if (flatMeeting(event)) {
    return Date.parse((event.triggerEvent === 'MEETING_STARTED' ? event.startTime : event.endTime) ?? '')
  }
  return Date.parse(event.createdAt ?? '')
}

export function isFlatMeetingWebhook(event: CalWebhookEvent) {
  return flatMeeting(event)
}

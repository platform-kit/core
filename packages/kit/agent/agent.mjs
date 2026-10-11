import { Agent, AgentSession, AgentSessionEventTypes, AutoSubscribe, cli, defineAgent, ServerOptions } from '@livekit/agents'
import { RoomEvent } from '@livekit/rtc-node'
import { fileURLToPath } from 'node:url'
import { EndpointLLM } from './providers.mjs'
import { assistantText, inputOf, INPUT_TOPIC, OUTPUT_TOPIC } from './protocol.mjs'

function baseURL() {
  if (process.env.COPILOT_BASE_URL) return process.env.COPILOT_BASE_URL
  if (process.env.APP_URL) return `${process.env.APP_URL.replace(/\/$/, '')}/v1`
  throw new Error('Set COPILOT_BASE_URL or APP_URL for the completion endpoint')
}

export default defineAgent({
  entry: async (ctx) => {
    const grant = ctx.job.metadata
    if (!grant) throw new Error('LiveKit job has no conversation grant')

    const llm = new EndpointLLM({ baseURL: baseURL(), grant })
    await ctx.connect(AutoSubscribe.SUBSCRIBE_NONE)
    const participant = await ctx.waitForParticipant()
    // Text-only turns need neither the SDK's inference-backed VAD nor its default turn detector.
    const session = new AgentSession({
      llm,
      vad: null,
      turnHandling: { turnDetection: null },
    })
    const agent = new Agent({ instructions: '' })
    let activeTurn = ''

    await session.start({
      agent,
      room: ctx.room,
      inputOptions: {
        audioEnabled: false,
        textEnabled: false,
        participantIdentity: participant.identity,
      },
      outputOptions: {
        audioEnabled: false,
        transcriptionEnabled: true,
        jsonFormat: true,
      },
    })

    const send = (message) => ctx.room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(message)),
      { reliable: true, topic: OUTPUT_TOPIC, destination_identities: [participant.identity] },
    )
    const reply = (event) => {
      const text = assistantText(event.item)
      if (!text || !activeTurn) return
      const id = activeTurn
      activeTurn = ''
      void send({ id, text }).catch((error) => console.error('Unable to send assistant reply', error))
    }
    session.on(AgentSessionEventTypes.ConversationItemAdded, reply)

    const receiveText = (payload, sender, _kind, topic) => {
      if (topic !== INPUT_TOPIC || sender?.identity !== participant.identity) return
      const turn = inputOf(payload)
      if (!turn) return
      if (activeTurn) session.interrupt()
      activeTurn = turn.id
      void session.generateReply({ userInput: turn.text, inputModality: 'text' }).catch((error) => {
        console.error('Unable to generate assistant reply', error)
        if (activeTurn === turn.id) {
          activeTurn = ''
          void send({ id: turn.id, error: true }).catch((sendError) => console.error('Unable to send assistant error', sendError))
        }
      })
    }
    ctx.room.on(RoomEvent.DataReceived, receiveText)
    ctx.addShutdownCallback(async () => {
      ctx.room.off(RoomEvent.DataReceived, receiveText)
      session.off(AgentSessionEventTypes.ConversationItemAdded, reply)
      await session.close()
    })
    await new Promise((resolve) => ctx.room.once(RoomEvent.Disconnected, resolve))
  },
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli.runApp(new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'copilot',
  }))
}

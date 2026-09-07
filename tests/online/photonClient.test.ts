import * as Photon from 'photon-realtime'
import { describe, expect, it } from 'vitest'
import { PhotonConnection } from '../../src/online/photonClient'

const LBC = Photon.LoadBalancing.LoadBalancingClient

type FakeClient = {
  onStateChange: (state: number) => void
  joinRoom: (code: string, joinOptions: unknown, createOptions: unknown) => void
  isJoinedToRoom: () => boolean
}
function asFakeClient(connection: PhotonConnection): FakeClient {
  return (connection as unknown as { client: FakeClient }).client
}

// Reported directly, with screenshots: one player's own screen was still mid-game while the
// *other* player's client displayed "X salió de la sala - la partida se detuvo" for a color that
// never actually left anything. Confirmed in the Photon Realtime SDK source
// (photon-realtime-module.js): _cleanupGamePeerData(), which runs on *any* local drop of a
// client's own connection to the game server (a WiFi blip, a backgrounded tab, anything transient),
// fires onActorLeave(actor, cleanup=true) for *every* cached actor - not just ones that genuinely
// left. Only cleanup=false is a real, individually server-reported departure of that one actor.
// Drives PhotonConnection's own client.onActorLeave field directly, exactly the shape the real SDK
// itself invokes it with (see src/online/photon-realtime.d.ts's own onActorLeave signature) -
// PhotonConnection's constructor never opens a real network connection on its own.
// Reported directly, with a live two-player test: the room creator's screen showed "X salió de la
// sala" and stopped the game while X's own screen never showed any interruption - traced to
// playerTTL never being set (Photon's server-side default is 0, no reconnection grace period at
// all). Confirms createRoom() actually passes a nonzero playerTTL through to the SDK's joinRoom
// call - drives PhotonConnection's own private `client` field directly rather than opening a real
// connection, same approach as the onActorLeft tests below.
describe('PhotonConnection.createRoom', () => {
  it('sets a nonzero playerTTL so a brief disconnect gets a reconnection grace period', () => {
    const connection = new PhotonConnection('fake-app-id')
    let capturedCreateOptions: { playerTTL?: number; maxPlayers?: number } | undefined
    ;(connection as unknown as { client: { joinRoom: (code: string, joinOptions: unknown, createOptions: { playerTTL?: number; maxPlayers?: number }) => void } }).client.joinRoom = (
      _code,
      _joinOptions,
      createOptions,
    ) => {
      capturedCreateOptions = createOptions
    }

    connection.createRoom('ABCDE', 4)

    expect(capturedCreateOptions?.playerTTL).toBeGreaterThan(0)
    expect(capturedCreateOptions?.maxPlayers).toBe(4)
  })
})

describe('PhotonConnection.onActorLeft', () => {
  const fakeActor = { actorNr: 7, isLocal: false, name: '', customProperties: {} }

  it('ignores a bulk local-cleanup sweep (cleanup=true) - not a real departure', () => {
    const connection = new PhotonConnection('fake-app-id')
    const seen: number[] = []
    connection.onActorLeft((actorNr) => seen.push(actorNr))

    ;(connection as unknown as { client: { onActorLeave: (actor: typeof fakeActor, cleanup: boolean) => void } }).client.onActorLeave(fakeActor, true)

    expect(seen).toEqual([])
  })

  it('still reports a genuine, individually server-reported departure (cleanup=false)', () => {
    const connection = new PhotonConnection('fake-app-id')
    const seen: number[] = []
    connection.onActorLeft((actorNr) => seen.push(actorNr))

    ;(connection as unknown as { client: { onActorLeave: (actor: typeof fakeActor, cleanup: boolean) => void } }).client.onActorLeave(fakeActor, false)

    expect(seen).toEqual([7])
  })
})

// Reported directly, with a screenshot: a player sitting on the "Jugar online" menu clicked
// "Crear" and got a raw SDK error ("PhotonPeer[_send] - Operation 226 - failed, \"isConnected\" is
// false...") instead of a room - the connection to the region master had silently died in the
// background, with nothing watching for it. Live network simulation (Playwright's own
// context.setOffline) turned out not to trigger the SDK's own onStateChange at all even after 35s
// - an already-open WebSocket apparently isn't actually severed by that kind of emulation, so this
// drives the client's own onStateChange field directly instead, exactly the shape the real SDK
// invokes it with.
describe('PhotonConnection.onConnectionLost', () => {
  it('fires when the connection state becomes Disconnected', () => {
    const connection = new PhotonConnection('fake-app-id')
    let firedCount = 0
    connection.onConnectionLost(() => {
      firedCount++
    })

    asFakeClient(connection).onStateChange(LBC.State.Disconnected)

    expect(firedCount).toBe(1)
  })

  it('fires when the connection state becomes Error', () => {
    const connection = new PhotonConnection('fake-app-id')
    let firedCount = 0
    connection.onConnectionLost(() => {
      firedCount++
    })

    asFakeClient(connection).onStateChange(LBC.State.Error)

    expect(firedCount).toBe(1)
  })

  it('does not fire for an unrelated state change', () => {
    const connection = new PhotonConnection('fake-app-id')
    let firedCount = 0
    connection.onConnectionLost(() => {
      firedCount++
    })

    asFakeClient(connection).onStateChange(LBC.State.JoinedLobby)

    expect(firedCount).toBe(0)
  })

  it('stops firing once unsubscribed', () => {
    const connection = new PhotonConnection('fake-app-id')
    let firedCount = 0
    const unsubscribe = connection.onConnectionLost(() => {
      firedCount++
    })
    unsubscribe()

    asFakeClient(connection).onStateChange(LBC.State.Disconnected)

    expect(firedCount).toBe(0)
  })

  it('still lets connect() resolve normally once onConnectionLost is also registered (chaining, not replacing)', async () => {
    const connection = new PhotonConnection('fake-app-id')
    let lostCount = 0
    connection.onConnectionLost(() => {
      lostCount++
    })

    const fakeClient = asFakeClient(connection) as unknown as FakeClient & { isInLobby: () => boolean; connectToRegionMaster: (region: string) => void }
    fakeClient.isInLobby = () => true
    fakeClient.connectToRegionMaster = () => {
      fakeClient.onStateChange(LBC.State.JoinedLobby)
    }

    await expect(connection.connect('us')).resolves.toBeUndefined()
    expect(lostCount).toBe(0)
  })

  // Reported directly, found live: registering onConnectionLost (OnlineLobbyScreen.tsx's own
  // 'menu'-phase effect) and then calling createRoom() (clicking "Crear") - with the
  // onConnectionLost subscriber unsubscribing *in between* createRoom() starting and its own
  // promise settling, matching a React effect's cleanup firing on the very next render once phase
  // changes away from 'menu' - used to silently destroy createRoom()'s own pending listener too:
  // the old implementation reassigned this.client.onStateChange directly and restored it to a
  // *snapshotted* previous value on unsubscribe, which stomped over whatever had been installed
  // on top in the meantime. The whole underlying SDK connection would succeed (reach the Joined
  // state) with nothing left listening for it - createRoom() never resolved or rejected, just hung
  // forever, exactly what a live two-browser test caught.
  it('createRoom still resolves even if an onConnectionLost subscriber unsubscribes mid-flight', async () => {
    const connection = new PhotonConnection('fake-app-id')
    const unsubscribeConnectionLost = connection.onConnectionLost(() => {})

    const fakeClient = asFakeClient(connection) as unknown as FakeClient & {
      isJoinedToRoom: () => boolean
      myRoomMasterActorNr: () => number
    }
    fakeClient.isJoinedToRoom = () => true
    fakeClient.myRoomMasterActorNr = () => 1
    fakeClient.joinRoom = () => {
      // Simulate the menu-phase effect's cleanup firing (phase changed away from 'menu') after
      // createRoom() has already registered its own state-change listener.
      unsubscribeConnectionLost()
      fakeClient.onStateChange(LBC.State.Joined)
    }

    await expect(connection.createRoom('ABCDE', 4)).resolves.toBeUndefined()
  })
})

// Reported directly, alongside the connection-loss finding above: the raw "isConnected is false"
// SDK exception reached the screen because joinRoom() itself throws synchronously when the
// underlying peer has already died - and since this whole call sits inside the createRoom()/
// joinRoom() promise's own executor, an uncaught throw there auto-rejects with that exact raw
// message. Confirms the explicit try/catch converts it into a friendly, prefixed message instead.
describe('PhotonConnection.createRoom / joinRoom - synchronous SDK failure', () => {
  it('converts a synchronous joinRoom() throw into a rejected promise with a friendly reason, not the raw SDK message', async () => {
    const connection = new PhotonConnection('fake-app-id')
    asFakeClient(connection).joinRoom = () => {
      throw new Error('PhotonPeer[_send] - Operation 226 - failed, "isConnected" is false , "isClosing" is false !')
    }

    await expect(connection.createRoom('ABCDE', 4)).rejects.toThrow(/lost connection/i)
  })
})

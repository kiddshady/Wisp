import { expect, test } from 'claude-code/testing'

type Aviso = { session?: string; name?: string; state: string; moment?: string }

// Lo que el mod le manda a Wisp, atrapado antes de salir; y una sesión con id y carpeta fijos.
function armar(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const avisos: Aviso[] = []
  on('http.fetch', async (_$, e) => {
    if (e.url.endsWith('/cc') && e.init?.method === 'POST') avisos.push(JSON.parse(e.init.body ?? '{}'))
    return { value: { status: 200, ok: true, headers: {}, text: '{"activo":true,"base":"idle"}' } }
  })
  on('session.id', async () => ({ value: 'sesion-1' }))
  on('session.cwd', async () => ({ value: 'S:\\tools\\Quire' }))
  on('env.get', async () => ({ value: undefined }))
  // Lo que haría el motor debajo de los plugins
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  // Los avisos salen en fila, sin esperarlos: se deja que la fila se vacíe.
  const asentar = () => new Promise(r => setTimeout(r, 50))
  return { avisos, asentar }
}

test('un turno: trabajando, y al terminar libre; festeja solo si fue largo', async ($, on) => {
  const { avisos, asentar } = armar(on)
  await $.turn.start({ text: 'hola', turnId: 't1' })
  await asentar()
  expect(avisos.at(-1)).toEqual({ session: 'sesion-1', name: 'Quire', state: 'working' })

  await $.turn.complete({ reason: 'answer', answer: 'listo', durationMs: 3000, isAborted: false, turnId: 't1' })
  await asentar()
  expect(avisos.at(-1)).toEqual({ session: 'sesion-1', name: 'Quire', state: 'idle' })

  await $.turn.start({ text: 'arreglá Quire', turnId: 't2' })
  await $.turn.complete({ reason: 'answer', answer: 'listo', durationMs: 90000, isAborted: false, turnId: 't2' })
  await asentar()
  expect(avisos.at(-1)).toEqual({ session: 'sesion-1', name: 'Quire', state: 'idle', moment: 'celebrate' })

  await $.turn.start({ text: 'otra', turnId: 't3' })
  await $.turn.complete({ reason: 'aborted', answer: '', durationMs: 4000, isAborted: true, turnId: 't3' })
  await asentar()
  expect(avisos.at(-1)?.moment).toBe('scared')
})

test('los turnos de un subagente no cuentan', async ($, on) => {
  const { avisos, asentar } = armar(on)
  await $.turn.start({ text: 'buscá', turnId: 's1', agentId: 'a1' })
  await $.turn.complete({ reason: 'answer', answer: 'x', durationMs: 60000, isAborted: false, turnId: 's1', agentId: 'a1' })
  await asentar()
  expect(avisos.length).toBe(0)
})

test('un permiso pone a Wisp a llamarte, y vuelve a trabajando cuando termina la herramienta', async ($, on) => {
  const { avisos, asentar } = armar(on)
  on('classic.PermissionRequest', async () => ({}))
  on('tool.call', async () => {
    // El cartel de permiso sale adentro de la llamada, como en una sesión de verdad.
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm test' } })
    await Promise.resolve()
    return { result: 'ok' } as never
  })
  await $.turn.start({ text: 'corré los tests', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await asentar()
  const estados = avisos.map(a => a.state)
  expect(estados).toEqual(['working', 'needs', 'working'])
})

test('/wisp off lo apaga en Wisp, y /wisp sin nada cuenta cómo está', async ($, on) => {
  const pedidos: { url: string; body?: string }[] = []
  on('env.get', async () => ({ value: undefined }))
  on('http.fetch', async (_$, e) => {
    pedidos.push({ url: e.url, body: e.init?.body })
    const activo = !(e.init?.body ?? '').includes('false')
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ activo, sesiones: [{ nombre: 'Quire', estado: 'needs' }] }) } }
  })
  const correr = (args: string) =>
    $.command.run({ command: 'wisp', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)

  expect((await correr('off')).text).toContain('not reacting')
  expect(pedidos.at(-1)).toEqual({ url: 'http://127.0.0.1:4790/cc/activo', body: '{"activo":false}' })
  expect((await correr('')).text).toContain('Quire: needs you')
  expect((await correr('bailá')).text).toContain('Usage:')
})

test('si Wisp no está abierto, /wisp lo dice y nada se rompe', async ($, on) => {
  on('env.get', async () => ({ value: undefined }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('http.fetch', async () => {
    throw new Error('ECONNREFUSED')
  })
  const r = await $.command.run({ command: 'wisp', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(r.text).toContain('not open')
  await $.turn.start({ text: 'hola', turnId: 't1' })
})

import type { EngineInterface, Register } from 'claude-code'

// Le cuenta a Wisp (S:\tools\Wisp) qué hace esta sesión, por HTTP local. Wisp junta lo de
// todas las sesiones y muestra lo más urgente: te necesita > trabaja > libre (src/cc.cjs).
// Si Wisp no está abierto, los avisos se pierden en silencio: el mod nunca frena a CC.

type Estado = 'idle' | 'working' | 'needs'
type Momento = 'celebrate' | 'scared'

const PUERTO = 4790
// Solo festeja los turnos largos: una respuesta corta no es para tanto.
const FESTEJO_MS = 20 * 1000
// Cada cuánto repite su estado. Wisp olvida a la sesión que pasa 150 s callada (cerrada sin avisar).
const LATIDO_MS = 60 * 1000
// Herramientas que esperan una respuesta tuya mientras corren.
const PREGUNTAS = new Set(['AskUserQuestion', 'ExitPlanMode'])
// Solo una persona en la app maneja /wisp: ni un par, ni un cronograma, ni otro plugin.
const PERSONA = new Set(['composer', 'bridge', 'sdk'])

const USO = [
  'Uso:',
  '  /wisp          cómo está la conexión con Wisp',
  '  /wisp on       que Wisp reaccione a Claude Code',
  '  /wisp off      que no reaccione (lo mismo que el tilde en su menú)',
].join('\n')

let estado: Estado = 'idle'
let latido: { cancel: () => void } | undefined
// Los avisos salen en fila: sueltos, un «libre» podía llegar antes que el «trabajando» previo.
let cola: Promise<unknown> = Promise.resolve()

async function base($: EngineInterface) {
  const puerto = Number(await $.env.get('WISP_PORT')) || PUERTO
  return `http://127.0.0.1:${puerto}`
}

function nombreDe(cwd: string) {
  const partes = cwd.split(/[\\/]+/).filter(Boolean)
  return partes[partes.length - 1] ?? cwd
}

async function post($: EngineInterface, cuerpo: Record<string, unknown>) {
  try {
    await $.http.fetch(`${await base($)}/cc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    })
  } catch {
    // Wisp cerrado o apagado: no es asunto de CC.
  }
}

function enFila(trabajo: () => Promise<unknown>) {
  cola = cola.then(trabajo).catch(() => undefined)
  return cola
}

function enviar($: EngineInterface, cuerpo: Record<string, unknown>) {
  return enFila(() => post($, cuerpo))
}

function avisar($: EngineInterface, nuevo: Estado, momento?: Momento) {
  estado = nuevo
  return enFila(async () => {
    const [session, cwd] = await Promise.all([$.session.id(), $.session.cwd()])
    await post($, { session, name: nombreDe(cwd), state: nuevo, moment: momento })
  })
}

async function pedir($: EngineInterface, ruta: string, cuerpo?: unknown) {
  const r = await $.http.fetch(`${await base($)}${ruta}`, cuerpo === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  return JSON.parse(r.text) as { activo: boolean; sesiones?: { nombre: string; estado: Estado }[] }
}

const ESTADOS: Record<Estado, string> = { idle: 'libre', working: 'trabajando', needs: 'te necesita' }

function describir(r: { activo: boolean; sesiones?: { nombre: string; estado: Estado }[] }) {
  if (!r.activo) return 'Wisp no reacciona a Claude Code. /wisp on lo prende.'
  const lista = (r.sesiones ?? []).map(s => `  ${s.nombre || 'sesión'}: ${ESTADOS[s.estado] ?? s.estado}`)
  return ['Wisp reacciona a Claude Code.', ...(lista.length ? ['Sesiones:', ...lista] : ['Ninguna sesión le avisó todavía.'])].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'wisp', description: 'Wisp reacciona a Claude Code: on, off o cómo está' })
    latido?.cancel()
    latido = $.clock.every(LATIDO_MS, () => avisar($, estado))
    avisar($, 'idle')
    return next(e)
  })

  // Un /clear termina la sesión y la siguiente sigue con otro id: la vieja se despide con el suyo.
  on('session.end', async ($, e, next) => {
    void enviar($, { session: e.sessionId, state: 'gone' })
    if (e.reason === 'clear') avisar($, 'idle')
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) avisar($, 'working')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const momento: Momento | undefined =
        e.reason === 'answer' ? (e.durationMs >= FESTEJO_MS ? 'celebrate' : undefined) : 'scared'
      avisar($, 'idle', momento)
    }
    return next(e)
  })

  // El cartel de permiso: CC queda frenado hasta que contestes.
  on('classic.PermissionRequest', async ($, e, next) => {
    avisar($, 'needs')
    return next(e)
  })

  // Una pregunta (AskUserQuestion, el plan) espera mientras corre. Cualquier herramienta que
  // termina con CC esperándote quiere decir que ya contestaste: vuelve a trabajar.
  on('tool.call', async ($, e, next) => {
    if (PREGUNTAS.has(e.tool)) avisar($, 'needs')
    const r = await next(e)
    if (estado === 'needs') avisar($, 'working')
    return r
  })

  on('command.run', { command: 'wisp' }, async ($, e) => {
    const origin = (e as { origin?: { kind: string } }).origin
    if (origin !== undefined && !PERSONA.has(origin.kind)) {
      return { text: `wisp: lo maneja Fran desde la app (esto vino de "${origin.kind}").` }
    }
    const verbo = (e.args ?? '').trim().toLowerCase()
    if (verbo !== '' && verbo !== 'on' && verbo !== 'off') return { text: USO }
    try {
      const r = verbo === '' ? await pedir($, '/cc') : await pedir($, '/cc/activo', { activo: verbo === 'on' })
      if (verbo === 'on') avisar($, estado)
      return { text: describir(r) }
    } catch {
      return { text: 'Wisp no está abierto (o es una versión sin la conexión con Claude Code, anterior a la 0.3.0).' }
    }
  })
}

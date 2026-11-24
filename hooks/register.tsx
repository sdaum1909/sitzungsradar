// Sitzungsradar: jede Sitzung schreibt einen Herzschlag in einen gemeinsamen Ordner,
// das Panel liest den Ordner und zeigt, was gerade über alle Projekte läuft.
import { atom, read, update } from 'claude-code'
import type { FsEntry, Hook, PluginOptions, Register, Timer } from 'claude-code'

import type { Herzschlag, Radar } from '../types'

type Api = Parameters<Hook<'session.start'>>[0]
type Lage = 'frage' | 'freigabe' | 'arbeitet' | 'wartet' | 'ruhig'

const PANE = 'sitzungsradar'
const TITEL = 'Sitzungsradar'
const TAKT_SCHREIBEN_MS = 20_000
const TAKT_LESEN_MS = 5_000
/** Ohne Herzschlag so lange gilt eine Sitzung als weg. */
const WEG_NACH_MS = 3 * 60_000
/** Läuft das jüngste Werkzeug so lange, wartet es vermutlich auf eine Freigabe. */
const FREIGABE_AB_MS = 60_000
const AUFRAEUMEN_NACH_MS = 24 * 60 * 60_000
const AUFRAEUMEN_TAKT_MS = 60_000
const AUFTRAG_LAENGE = 140
/** Werkzeuge, die auf eine Antwort von dir warten. */
const FRAGT_DICH = new Set(['AskUserQuestion', 'ExitPlanMode'])

// Kapitel und Aufgabenliste setzt die Desktop-App über diese Werkzeuge.
const KAPITEL = 'mcp__ccd_session__mark_chapter'
const PLAN = 'mcp__ccd_turn__update_plan'
const ABSCHLUSS = 'mcp__ccd_turn__wrap_up'
const SPUR_WERKZEUGE = new Set([KAPITEL, PLAN, ABSCHLUSS])
/** So sieht die Kennung einer Sitzung in der Desktop-App aus. */
const HOST_ID = /^local_[A-Za-z0-9-]{1,64}$/
const linkVon = (hostId: string) => `claude://code/continue?session=${hostId}`
// Im Protokoll (JSONL) stehen Titel und Werkzeugaufrufe als eigene Datensätze.
const TITEL_MUSTER = /"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"/g
const AUFRUF_MUSTER =
  /"type":"tool_use","id":"([^"]+)","name":"(mcp__ccd_session__mark_chapter|mcp__ccd_turn__update_plan|mcp__ccd_turn__wrap_up)","input":/g
/** Höchstens so viel liest ein Aufruf von $.fs.read. */
const BLOCK = 4 * 1024 * 1024
/** Beim ersten Blick höchstens so weit zurück. */
const SUCHE_MAX = 16 * 1024 * 1024
/** So viel liest jeder Blick noch einmal, falls ein Datensatz gerade halb geschrieben war. */
const UEBERLAPPUNG = 64 * 1024
const TEXT_LAENGE = 80
const PLAN_MAX = 30
const GESEHEN_MAX = 2000

// Tag ändern, wenn sich die Felder von Radar ändern: ein älterer Wert wird dann verworfen.
const radar = atom(
  { plugin: 'sitzungsradar', key: 'radar' } as const,
  { liste: [], gelesen: 0 },
  { shape: 'radar-2' },
)

type Einstellungen = {
  zeigeAuftrag: boolean
  ruhigAbMs: number
  beimStartOeffnen: boolean
  ordner: string
}

const einstellungen = (o: PluginOptions): Einstellungen => {
  const min =
    typeof o.ruhig_ab_minuten === 'number' && o.ruhig_ab_minuten > 0
      ? o.ruhig_ab_minuten
      : 15
  return {
    zeigeAuftrag: o.zeige_auftrag !== false,
    ruhigAbMs: min * 60_000,
    beimStartOeffnen: o.beim_start_oeffnen !== false,
    ordner: typeof o.ordner === 'string' ? o.ordner.trim().replace(/\/+$/, '') : '',
  }
}

const name = (pfad: string) => pfad.replace(/\/+$/, '').split('/').pop() || pfad

/** Projekt (Repo) und Worktree aus dem Arbeitsordner. */
export const projektVon = (ordner: string, stamm?: string) => {
  const wt = ordner.match(/^(.*)\/\.claude\/worktrees\/([^/]+)/)
  if (wt) return { projekt: name(wt[1] ?? ordner), zweig: wt[2] }
  if (stamm && stamm !== ordner && !ordner.startsWith(`${stamm}/`))
    return { projekt: name(stamm), zweig: name(ordner) }
  return { projekt: name(stamm ?? ordner) }
}

export const dauer = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
  return `${Math.floor(h / 24)} Tagen`
}

const kuerzen = (t: string, n: number) =>
  t.length <= n ? t : n <= 1 ? '…' : `${t.slice(0, n - 1)}…`

const einzeilig = (t: string) => t.replace(/\s+/g, ' ').trim()

const werkzeugName = (t: string) => (t.startsWith('mcp__') ? t.split('__').pop() || t : t)

const modellKurz = (m?: string) => (m ? m.replace(/^claude-/, '').replace(/\[.*\]$/, '') : '')

export const lageVon = (h: Herzschlag, jetzt: number, ruhigAbMs: number): Lage => {
  if (h.status === 'arbeitet') {
    if (h.werkzeug && FRAGT_DICH.has(h.werkzeug.name)) return 'frage'
    if (h.werkzeug && jetzt - h.werkzeug.seit >= FREIGABE_AB_MS) return 'freigabe'
    return 'arbeitet'
  }
  return jetzt - h.statusSeit >= ruhigAbMs ? 'ruhig' : 'wartet'
}

const RANG: Record<Lage, number> = { frage: 0, freigabe: 1, wartet: 2, arbeitet: 3, ruhig: 4 }
const ZEICHEN: Record<Lage, string> = { frage: '◆', freigabe: '◆', arbeitet: '●', wartet: '○', ruhig: '·' }
const FARBE: Record<Lage, string | undefined> = {
  frage: 'permission',
  freigabe: 'permission',
  arbeitet: 'success',
  wartet: 'warning',
  ruhig: undefined,
}

export const ordnen = (liste: readonly Herzschlag[], jetzt: number, ruhigAbMs: number) =>
  liste
    .map(h => ({ h, lage: lageVon(h, jetzt, ruhigAbMs) }))
    .sort(
      (a, b) =>
        RANG[a.lage] - RANG[b.lage] ||
        a.h.projekt.localeCompare(b.h.projekt) ||
        (a.h.zweig ?? '').localeCompare(b.h.zweig ?? '') ||
        a.h.id.localeCompare(b.h.id),
    )

const herkunftVon = (h: Herzschlag) => `${h.projekt}${h.zweig ? ` › ${h.zweig}` : ''}`
/** Der Name, unter dem du die Sitzung kennst: ihr Titel, sonst Projekt und Worktree. */
const anzeigeVon = (h: Herzschlag) => h.titel || herkunftVon(h)
const hatSprung = (h: Herzschlag, eigeneId?: string) =>
  h.id !== eigeneId && !!h.hostId && HOST_ID.test(h.hostId)

/** Kapitel und Schritt, in einer Zeile oder, wenn sie nicht passt, in zweien. */
export const abschnittVon = (h: Herzschlag, breite: number): string[] => {
  const teile: string[] = []
  if (h.abschnitt) teile.push(`Abschnitt: ${h.abschnitt}`)
  const s = h.schritt
  // Läuft kein Schritt, sagt der Statussatz aus der Seitenleiste der App mehr als „Plan erledigt“.
  if (s && !s.fertig) teile.push(`Schritt ${s.nr}/${s.von}: ${s.text}`)
  else if (h.stand) teile.push(`Stand: ${h.stand}`)
  else if (s) teile.push(`Plan erledigt (${s.von}/${s.von})`)
  if (teile.length === 0) return []
  const eine = `  ${teile.join(' · ')}`
  if (eine.length <= breite || teile.length === 1) return [kuerzen(eine, breite)]
  return teile.map(t => kuerzen(`  ${t}`, breite))
}

// ---- Kapitel und Aufgabenliste -------------------------------------------------------

type Punkt = { text: string; status: 'pending' | 'in_progress' | 'completed' }
export type Spur = { abschnitt?: string; plan?: Punkt[]; stand?: string }
type Aufruf = { id: string; tool: string; a: Record<string, unknown> }

const zeile = (v: unknown) => (typeof v === 'string' ? kuerzen(einzeilig(v), TEXT_LAENGE) : '')
/** Der erste Satz: den zeigt die App als Status in ihrer Seitenleiste. */
export const ersterSatz = (v: unknown) =>
  typeof v === 'string' ? zeile(einzeilig(v).split(/(?<=[.!?])\s/)[0]) : ''

/** Wendet einen Aufruf von Kapitel, Aufgabenliste oder Abschluss an, so wie die App ihn liest. */
export function spurWeiter(s: Spur, tool: string, a: Record<string, unknown>): Spur {
  if (tool === KAPITEL) {
    const t = zeile(a.title)
    return t ? { ...s, abschnitt: t } : s
  }
  if (tool === ABSCHLUSS) {
    const stand = ersterSatz(a.recap) || s.stand
    const plan = s.plan?.map(p => ({ ...p, status: 'completed' as const }))
    return { ...s, ...(plan ? { plan } : {}), ...(stand ? { stand } : {}) }
  }
  if (tool !== PLAN) return s
  let plan: Punkt[] = (s.plan ?? []).map(p => ({ ...p }))
  if (Array.isArray(a.items))
    plan = a.items.slice(0, PLAN_MAX).map(p => {
      const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
      const status = o.status === 'in_progress' || o.status === 'completed' ? o.status : 'pending'
      return { text: zeile(o.content), status }
    })
  const stelle = (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= plan.length ? v - 1 : -1
  if (Array.isArray(a.done))
    for (const d of a.done) {
      const p = plan[stelle(d)]
      if (p) p.status = 'completed'
    }
  const start = plan[stelle(a.start)]
  if (start) {
    for (const p of plan) if (p.status === 'in_progress') p.status = 'pending'
    start.status = 'in_progress'
  }
  if (a.advance === true) {
    const jetzt = plan.findIndex(p => p.status === 'in_progress')
    const laeuft = plan[jetzt]
    if (laeuft) laeuft.status = 'completed'
    let weiter = plan.findIndex((p, i) => i > jetzt && p.status === 'pending')
    if (weiter < 0) weiter = plan.findIndex(p => p.status === 'pending')
    const naechster = plan[weiter]
    if (naechster) naechster.status = 'in_progress'
  }
  return { ...s, plan }
}

/** Der laufende Schritt; sind alle erledigt, das; sonst der nächste offene. */
export function schrittVon(plan?: readonly Punkt[]): Herzschlag['schritt'] {
  if (!plan || plan.length === 0) return undefined
  const von = plan.length
  let i = plan.findIndex(p => p.status === 'in_progress')
  if (i < 0) {
    if (plan.every(p => p.status === 'completed')) return { text: '', nr: von, von, fertig: true }
    i = plan.findIndex(p => p.status === 'pending')
  }
  const p = plan[i]
  return p ? { text: p.text, nr: i + 1, von } : undefined
}

/** Das JSON-Objekt, das bei `i` beginnt, mit Rücksicht auf Zeichenketten. */
function objektAb(t: string, i: number): string | undefined {
  if (t[i] !== '{') return undefined
  let tiefe = 0
  let inText = false
  for (let j = i; j < t.length; j++) {
    const c = t[j]
    if (inText) {
      if (c === '\\') j++
      else if (c === '"') inText = false
      continue
    }
    if (c === '"') inText = true
    else if (c === '{' || c === '[') tiefe++
    else if ((c === '}' || c === ']') && --tiefe === 0) return t.slice(i, j + 1)
  }
  return undefined
}

/** Titel und Aufrufe in einem Stück Protokoll, in der Reihenfolge, in der sie stehen. */
export function protokollAuswerten(t: string): { titel?: string; aufrufe: Aufruf[] } {
  let titel: string | undefined
  for (const m of t.matchAll(TITEL_MUSTER)) {
    try {
      const v = zeile(JSON.parse(`"${m[1]}"`))
      if (v) titel = v
    } catch {
      // abgeschnitten
    }
  }
  const aufrufe: Aufruf[] = []
  for (const m of t.matchAll(AUFRUF_MUSTER)) {
    const roh = objektAb(t, (m.index ?? 0) + m[0].length)
    if (!roh || !m[1] || !m[2]) continue
    try {
      const a: unknown = JSON.parse(roh)
      if (a && typeof a === 'object' && !Array.isArray(a))
        aufrufe.push({ id: m[1], tool: m[2], a: a as Record<string, unknown> })
    } catch {
      // halb geschrieben: der nächste Blick liest es noch einmal
    }
  }
  return { titel, aufrufe }
}

export const zustandVon = (h: Herzschlag, lage: Lage, jetzt: number) => {
  const w = h.werkzeug
  switch (lage) {
    case 'frage':
      return `fragt dich (${w?.name})`
    case 'freigabe':
      return `${w?.name} läuft seit ${dauer(jetzt - (w?.seit ?? jetzt))} · Freigabe?`
    case 'arbeitet':
      return `arbeitet seit ${dauer(jetzt - h.statusSeit)}${w ? ` · ${w.name}${w.anzahl > 1 ? ` +${w.anzahl - 1}` : ''}` : ''}`
    case 'wartet':
      return `wartet auf dich seit ${dauer(jetzt - h.statusSeit)}`
    case 'ruhig':
      return `ruhig seit ${dauer(jetzt - h.statusSeit)}`
  }
}

export const kopfVon = (zeilen: readonly { lage: Lage }[]) => {
  const zahl = (l: Lage[]) => zeilen.filter(z => l.includes(z.lage)).length
  const teile = [`${zeilen.length} ${zeilen.length === 1 ? 'Sitzung' : 'Sitzungen'}`]
  const dran = zahl(['frage', 'freigabe'])
  const wartet = zahl(['wartet'])
  const arbeitet = zahl(['arbeitet'])
  if (dran) teile.push(`${dran} ${dran === 1 ? 'braucht' : 'brauchen'} dich`)
  if (wartet) teile.push(`${wartet} ${wartet === 1 ? 'wartet' : 'warten'}`)
  if (arbeitet) teile.push(`${arbeitet} ${arbeitet === 1 ? 'arbeitet' : 'arbeiten'}`)
  return teile.join(' · ')
}

// Zustand dieser Sitzung. Ein Neuladen des Mods setzt ihn zurück; register() setzt ihn ebenfalls.
let cfg: Einstellungen = { zeigeAuftrag: true, ruhigAbMs: 15 * 60_000, beimStartOeffnen: true, ordner: '' }
const laufend = new Map<string, { name: string; seit: number }>()
let ordnerPfad: string | undefined
let eigene: Herzschlag | undefined
let schreibTakt: Timer | undefined
let leseTakt: Timer | undefined
let kette: Promise<void> = Promise.resolve()
let zuletztAufgeraeumt = 0
let statuszeile: string | undefined
let stand: Radar = { liste: [], gelesen: 0 }
let zaehler = 0
// Titel und Abschnitt dieser Sitzung, aus ihrem eigenen Protokoll und den Werkzeugaufrufen.
let titel: string | undefined
let spur: Spur = {}
let protokoll: { pfad: string; bis: number } | undefined
let protokollLaeuft: Promise<void> | undefined
const gesehen = new Set<string>()

function spurZuruecksetzen() {
  titel = undefined
  spur = {}
  protokoll = undefined
  protokollLaeuft = undefined
  gesehen.clear()
}

/** true, wenn die Aufruf-Id neu ist; merkt sie sich (begrenzt). */
function merken(id: string) {
  if (gesehen.has(id)) return false
  gesehen.add(id)
  if (gesehen.size > GESEHEN_MAX) {
    const alt = gesehen.values().next().value
    if (alt !== undefined) gesehen.delete(alt)
  }
  return true
}

function anwenden(fund: ReturnType<typeof protokollAuswerten>) {
  if (fund.titel) titel = fund.titel
  for (const a of fund.aufrufe) if (merken(a.id)) spur = spurWeiter(spur, a.tool, a.a)
}

/**
 * Liest das eigene Protokoll nur dort, wo es gewachsen ist. Beim ersten Blick von hinten
 * in Blöcken, bis Titel, Kapitel und Aufgabenliste gefunden sind (höchstens SUCHE_MAX).
 */
async function protokollLesenJetzt($: Api) {
  const info = await $.session.info()
  const pfad = info.transcriptPath
  if (!pfad) return
  const st = await $.fs.stat(pfad)
  if (st.kind !== 'file') return
  const groesse = st.size
  if (protokoll && protokoll.pfad === pfad && protokoll.bis === groesse) return

  if (!protokoll || protokoll.pfad !== pfad || groesse < protokoll.bis) {
    const funde: ReturnType<typeof protokollAuswerten>[] = []
    let ende = groesse
    let gelesen = 0
    let hatTitel = false
    let hatKapitel = false
    let hatPlan = false
    while (ende > 0 && gelesen < SUCHE_MAX) {
      const start = Math.max(0, ende - BLOCK)
      const fund = protokollAuswerten(await $.fs.read(pfad, { offset: start, length: ende - start }))
      funde.unshift(fund)
      gelesen += ende - start
      hatTitel ||= !!fund.titel
      for (const a of fund.aufrufe) {
        if (a.tool === KAPITEL) hatKapitel = true
        if (a.tool === PLAN && Array.isArray(a.a.items)) hatPlan = true
      }
      if (start === 0 || (hatTitel && hatKapitel && hatPlan)) break
      ende = start + UEBERLAPPUNG
    }
    gesehen.clear()
    spur = {}
    titel = undefined
    for (const f of funde) anwenden(f)
  } else {
    let pos = Math.max(0, protokoll.bis - UEBERLAPPUNG, groesse - SUCHE_MAX)
    while (pos < groesse) {
      const laenge = Math.min(BLOCK, groesse - pos)
      anwenden(protokollAuswerten(await $.fs.read(pfad, { offset: pos, length: laenge })))
      if (pos + laenge >= groesse) break
      pos += laenge - UEBERLAPPUNG
    }
  }
  protokoll = { pfad, bis: groesse }
}

/** Nie zwei Blicke gleichzeitig; danach den Herzschlag schreiben, wenn sich etwas geändert hat. */
function protokollLesen($: Api) {
  if (protokollLaeuft) return protokollLaeuft
  const vorher = JSON.stringify([titel, spur.abschnitt, spur.stand, schrittVon(spur.plan)])
  protokollLaeuft = protokollLesenJetzt($)
    .catch(() => {})
    .then(async () => {
      if (JSON.stringify([titel, spur.abschnitt, spur.stand, schrittVon(spur.plan)]) !== vorher) await schreiben($)
    })
    .finally(() => {
      protokollLaeuft = undefined
    })
  return protokollLaeuft
}

/** Öffnet die Sitzung in der Desktop-App; klappt das nicht, steht der Link im Hinweis. */
async function springen($: Api, hostId?: string) {
  if (!hostId || !HOST_ID.test(hostId)) return
  const url = linkVon(hostId)
  try {
    const windows = (await $.session.info().catch(() => undefined))?.platform === 'windows'
    const befehl = windows ? ['rundll32', 'url.dll,FileProtocolHandler', url] : ['open', url]
    const r = await $.process.run(befehl, { timeoutMs: 5_000 })
    if (r.exitCode === 0) return
  } catch {
    // weiter zum Hinweis
  }
  try {
    $.ui.toast(`Sitzung lässt sich nicht öffnen. Link: ${url}`)
  } catch {
    // kein Hinweis möglich
  }
}

async function ordnerHolen($: Api) {
  if (ordnerPfad) return ordnerPfad
  const home = await $.env.get('HOME')
  if (cfg.ordner) ordnerPfad = home ? cfg.ordner.replace(/^~(?=\/|$)/, home) : cfg.ordner
  else if (home) ordnerPfad = `${home}/.claude/sitzungsradar`
  return ordnerPfad
}

const dateiVon = (ordner: string, id: string) =>
  `${ordner}/${id.replace(/[^A-Za-z0-9._-]/g, '_')}.json`

/** Das jüngste laufende Werkzeug und wie viele gerade laufen. */
const werkzeugJetzt = () => {
  let neu: { name: string; seit: number } | undefined
  for (const w of laufend.values()) if (!neu || w.seit >= neu.seit) neu = w
  return neu && { name: neu.name, seit: neu.seit, anzahl: laufend.size }
}

async function anfangen($: Api, id: string, jetzt: number): Promise<Herzschlag> {
  const [ordner, repo, modell, oberflaeche, host] = await Promise.all([
    $.session.cwd(),
    $.session.repo().catch(() => null),
    $.session.model().catch(() => undefined),
    $.session.surface().catch(() => null),
    $.env.get('CLAUDE_CODE_HOST_SESSION_ID').catch(() => undefined),
  ])
  return {
    v: 1,
    id,
    ...projektVon(ordner, repo?.root),
    ordner,
    modell,
    status: 'wartet',
    statusSeit: jetzt,
    zuletzt: jetzt,
    oberflaeche: oberflaeche ?? undefined,
    hostId: host && HOST_ID.test(host) ? host : undefined,
  }
}

async function schreibenJetzt($: Api, aenderung: Partial<Herzschlag>) {
  const ordner = await ordnerHolen($)
  if (!ordner) return
  const jetzt = await $.clock.now()
  const id = await $.session.id()
  if (!eigene || eigene.id !== id) {
    // Neue Sitzungs-Id (etwa nach /clear): die alte Datei abschließen.
    if (eigene && eigene.status !== 'beendet')
      await $.fs.write(
        dateiVon(ordner, eigene.id),
        JSON.stringify({ ...eigene, status: 'beendet', zuletzt: jetzt }),
      )
    eigene = await anfangen($, id, jetzt)
  }
  const vorher = eigene.status
  eigene = {
    ...eigene,
    ...aenderung,
    titel,
    abschnitt: spur.abschnitt,
    schritt: schrittVon(spur.plan),
    stand: spur.stand,
    werkzeug: werkzeugJetzt(),
    zuletzt: jetzt,
  }
  if (aenderung.status && aenderung.status !== vorher) eigene.statusSeit = jetzt
  await $.fs.write(dateiVon(ordner, id), JSON.stringify(eigene))
}

/** Schreibt der Reihe nach, damit sich zwei Ereignisse nicht überholen. */
function schreiben($: Api, aenderung: Partial<Herzschlag> = {}) {
  kette = kette.then(() => schreibenJetzt($, aenderung)).catch(() => {})
  return kette
}

async function abschliessen($: Api) {
  const ordner = await ordnerHolen($)
  if (!ordner || !eigene) return
  const jetzt = await $.clock.now()
  eigene = { ...eigene, status: 'beendet', werkzeug: undefined, zuletzt: jetzt }
  await $.fs.write(dateiVon(ordner, eigene.id), JSON.stringify(eigene))
}

/** Löscht Dateien beendeter und lange stiller Sitzungen, höchstens einmal je Minute. */
async function aufraeumen($: Api, pfade: string[], jetzt: number) {
  if (pfade.length === 0 || jetzt - zuletztAufgeraeumt < AUFRAEUMEN_TAKT_MS) return
  zuletztAufgeraeumt = jetzt
  await $.process.run(['rm', '--', ...pfade]).catch(() => undefined)
}

function statuszeileSetzen($: Api, zeilen: readonly { lage: Lage }[]) {
  const dran = zeilen.filter(z => z.lage === 'frage' || z.lage === 'freigabe').length
  const wartet = zeilen.filter(z => z.lage === 'wartet').length
  const text =
    zeilen.length === 0
      ? undefined
      : `Radar ${zeilen.length}${dran ? ` · ${dran} braucht dich` : ''}${wartet ? ` · ${wartet} wartet` : ''}`
  if (text === statuszeile) return
  statuszeile = text
  void Promise.resolve($.ui.status(text)).catch(() => {})
}

async function lesen($: Api) {
  const ordner = await ordnerHolen($)
  const jetzt = await $.clock.now()
  const eigeneId = await $.session.id().catch(() => undefined)
  const basis = { gelesen: jetzt, eigeneId, ruhigAbMs: cfg.ruhigAbMs, zeigeAuftrag: cfg.zeigeAuftrag }
  if (!ordner) {
    stand = { liste: [], ...basis, fehler: 'HOME ist nicht gesetzt, kein Ordner für die Herzschläge.' }
    await update($, radar, () => stand)
    return
  }
  let eintraege: readonly FsEntry[] = []
  try {
    eintraege = await $.fs.list(ordner)
  } catch {
    eintraege = [] // Ordner gibt es noch nicht
  }
  const liste: Herzschlag[] = []
  const weg: string[] = []
  for (const d of eintraege) {
    if (d.kind !== 'file' || d.isLink || !d.name.endsWith('.json')) continue
    const pfad = `${ordner}/${d.name}`
    if (jetzt - d.mtimeMs > AUFRAEUMEN_NACH_MS) {
      weg.push(pfad)
      continue
    }
    if (jetzt - d.mtimeMs > WEG_NACH_MS) continue
    try {
      const h = JSON.parse(await $.fs.read(pfad)) as Herzschlag
      if (h?.v !== 1 || typeof h.id !== 'string' || typeof h.projekt !== 'string') continue
      if (h.status === 'beendet') {
        weg.push(pfad)
        continue
      }
      if (jetzt - h.zuletzt > WEG_NACH_MS) continue
      liste.push(h)
    } catch {
      // halb geschrieben oder fremd: beim nächsten Takt
    }
  }
  stand = { liste, ...basis }
  await update($, radar, () => stand)
  statuszeileSetzen($, ordnen(liste, jetzt, cfg.ruhigAbMs))
  await aufraeumen($, weg, jetzt)
}

function oeffnen($: Api) {
  return $.ui
    .open({ id: PANE, title: TITEL })
    .catch(() => ({ isPlaced: false as const, reason: 'belegt' }))
}

export const register: Register = (on, options) => {
  cfg = einstellungen(options)
  laufend.clear()
  ordnerPfad = undefined
  eigene = undefined
  kette = Promise.resolve()
  statuszeile = undefined
  stand = { liste: [], gelesen: 0 }
  zuletztAufgeraeumt = 0
  zaehler = 0
  spurZuruecksetzen()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sitzungsradar',
      description: 'Zeigt alle gerade laufenden Claude-Code-Sitzungen über alle Projekte',
    })
    schreibTakt?.cancel()
    leseTakt?.cancel()
    schreibTakt = $.clock.every(TAKT_SCHREIBEN_MS, () => {
      void schreiben($)
      void protokollLesen($)
    })
    leseTakt = $.clock.every(TAKT_LESEN_MS, () => void lesen($).catch(() => {}))
    await schreiben($)
    await lesen($).catch(() => {})
    if (cfg.beimStartOeffnen) void oeffnen($)
    // Titel und Abschnitt im Hintergrund nachholen; der Start wartet nicht darauf.
    void protokollLesen($)

    return next(e)
  })

  on('command.run', { command: 'sitzungsradar' }, async $ => {
    await lesen($).catch(() => {})
    const platz = await oeffnen($)
    const zeilen = ordnen(stand.liste, stand.gelesen, cfg.ruhigAbMs)
    const text = [
      `${TITEL}: ${zeilen.length ? kopfVon(zeilen) : 'keine Sitzung gemeldet'}`,
      ...zeilen.flatMap(({ h, lage }) => [
        `${ZEICHEN[lage]} ${anzeigeVon(h)}${h.id === stand.eigeneId ? ' (diese Sitzung)' : ''}: ${zustandVon(h, lage, stand.gelesen)}`,
        ...(h.titel ? [`   ${herkunftVon(h)}`] : []),
        ...abschnittVon(h, 200).map(z => ` ${z}`),
        ...(hatSprung(h, stand.eigeneId) && h.hostId ? [`   Öffnen: ${linkVon(h.hostId)}`] : []),
      ]),
      ...(platz.isPlaced ? [] : ['', 'Das Panel hat gerade keinen Platz, die Liste steht deshalb hier.']),
    ].join('\n')

    return { text }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const t = einzeilig(e.text ?? '')
      const aenderung: Partial<Herzschlag> = {
        status: 'arbeitet',
        modell: await $.session.model().catch(() => eigene?.modell),
      }
      // Vom System gestartete Züge (Benachrichtigungen) behalten den letzten Auftrag.
      if (cfg.zeigeAuftrag && t && !t.startsWith('<')) aenderung.auftrag = kuerzen(t, AUFTRAG_LAENGE)
      await schreiben($, aenderung)
      void protokollLesen($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ergebnis = await next(e)
    if (e.agentId === undefined) {
      laufend.clear()
      await schreiben($, { status: 'wartet' })
      void protokollLesen($)
    }
    return ergebnis
  })

  on('tool.call', async ($, e, next) => {
    // Kapitel und Aufgabenliste sofort übernehmen, ohne aufs Protokoll zu warten.
    if (e.agentId === undefined && SPUR_WERKZEUGE.has(e.tool) && (!e.tool_use_id || merken(e.tool_use_id)))
      spur = spurWeiter(spur, e.tool, e as unknown as Record<string, unknown>)
    const schluessel = e.tool_use_id || `w${++zaehler}`
    laufend.set(schluessel, { name: werkzeugName(e.tool), seit: await $.clock.now() })
    await schreiben($)
    try {
      return await next(e)
    } finally {
      laufend.delete(schluessel)
      await schreiben($)
    }
  })

  on('session.end', async ($, e, next) => {
    kette = kette.then(() => abschliessen($)).catch(() => {})
    await kette
    if (e.reason === 'clear') {
      eigene = undefined
      spurZuruecksetzen()
    } else {
      schreibTakt?.cancel()
      leseTakt?.cancel()
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const r = await read($, radar)
    const breite = Math.max(20, e.props.bodyColumns ?? 40)
    const ruhigAb = r.ruhigAbMs ?? 15 * 60_000
    const zeilen = ordnen(r.liste, r.gelesen, ruhigAb)
    const kopf = (s: Herzschlag, lage: Lage, platz: number) => (
      <Text color={FARBE[lage]} dimColor={lage === 'ruhig'}>
        {kuerzen(
          `${ZEICHEN[lage]} ${anzeigeVon(s)}${s.id === r.eigeneId ? '  (diese Sitzung)' : ''}`,
          platz,
        )}
      </Text>
    )

    return (
      <Box flexDirection="column">
        <Text dimColor>{kuerzen(zeilen.length ? kopfVon(zeilen) : 'Läuft gerade', breite)}</Text>
        {r.fehler && <Text color="error">{r.fehler}</Text>}
        {zeilen.length === 0 && !r.fehler && (
          <Text dimColor>
            Noch keine Sitzung gemeldet. Jede Sitzung mit diesem Mod erscheint hier, sobald sie startet.
          </Text>
        )}
        {zeilen.map(({ h: s, lage }) => (
          <Box flexDirection="column">
            <Text> </Text>
            {hatSprung(s, r.eigeneId) ? (
              <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
                <Box flexShrink={1}>{kopf(s, lage, breite - 11)}</Box>
                <Button
                  key={`oeffnen-${s.id}`}
                  label="Öffnen"
                  variant={lage === 'frage' || lage === 'freigabe' ? 'primary' : 'secondary'}
                  onPress={() => void springen($, s.hostId)}
                />
              </Box>
            ) : (
              kopf(s, lage, breite)
            )}
            <Text dimColor>
              {kuerzen(
                `  ${zustandVon(s, lage, r.gelesen)}${s.titel ? ` · ${herkunftVon(s)}` : ''}${s.modell ? ` · ${modellKurz(s.modell)}` : ''}`,
                breite,
              )}
            </Text>
            {abschnittVon(s, breite).map(z => (
              <Text dimColor>{z}</Text>
            ))}
            {r.zeigeAuftrag !== false && s.auftrag && (
              <Text dimColor>{kuerzen(`  „${s.auftrag}“`, breite)}</Text>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}

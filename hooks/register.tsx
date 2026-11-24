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

// Tag ändern, wenn sich die Felder von Radar ändern: ein älterer Wert wird dann verworfen.
const radar = atom(
  { plugin: 'sitzungsradar', key: 'radar' } as const,
  { liste: [], gelesen: 0 },
  { shape: 'radar-1' },
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

const titelVon = (h: Herzschlag) => `${h.projekt}${h.zweig ? ` › ${h.zweig}` : ''}`

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
  const [ordner, repo, modell, oberflaeche] = await Promise.all([
    $.session.cwd(),
    $.session.repo().catch(() => null),
    $.session.model().catch(() => undefined),
    $.session.surface().catch(() => null),
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
  eigene = { ...eigene, ...aenderung, werkzeug: werkzeugJetzt(), zuletzt: jetzt }
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

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sitzungsradar',
      description: 'Zeigt alle gerade laufenden Claude-Code-Sitzungen über alle Projekte',
    })
    schreibTakt?.cancel()
    leseTakt?.cancel()
    schreibTakt = $.clock.every(TAKT_SCHREIBEN_MS, () => void schreiben($))
    leseTakt = $.clock.every(TAKT_LESEN_MS, () => void lesen($).catch(() => {}))
    await schreiben($)
    await lesen($).catch(() => {})
    if (cfg.beimStartOeffnen) void oeffnen($)

    return next(e)
  })

  on('command.run', { command: 'sitzungsradar' }, async $ => {
    await lesen($).catch(() => {})
    const platz = await oeffnen($)
    const zeilen = ordnen(stand.liste, stand.gelesen, cfg.ruhigAbMs)
    const text = [
      `${TITEL}: ${zeilen.length ? kopfVon(zeilen) : 'keine Sitzung gemeldet'}`,
      ...zeilen.map(
        ({ h, lage }) =>
          `${ZEICHEN[lage]} ${titelVon(h)}${h.id === stand.eigeneId ? ' (diese Sitzung)' : ''}: ${zustandVon(h, lage, stand.gelesen)}`,
      ),
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
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ergebnis = await next(e)
    if (e.agentId === undefined) {
      laufend.clear()
      await schreiben($, { status: 'wartet' })
    }
    return ergebnis
  })

  on('tool.call', async ($, e, next) => {
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
    if (e.reason === 'clear') eigene = undefined
    else {
      schreibTakt?.cancel()
      leseTakt?.cancel()
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const r = await read($, radar)
    const breite = Math.max(20, e.props.bodyColumns ?? 40)
    const ruhigAb = r.ruhigAbMs ?? 15 * 60_000
    const zeilen = ordnen(r.liste, r.gelesen, ruhigAb)

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
            <Text color={FARBE[lage]} dimColor={lage === 'ruhig'}>
              {kuerzen(
                `${ZEICHEN[lage]} ${titelVon(s)}${s.id === r.eigeneId ? '  (diese Sitzung)' : ''}`,
                breite,
              )}
            </Text>
            <Text dimColor>
              {kuerzen(
                `  ${zustandVon(s, lage, r.gelesen)}${s.modell ? ` · ${modellKurz(s.modell)}` : ''}`,
                breite,
              )}
            </Text>
            {r.zeigeAuftrag !== false && s.auftrag && (
              <Text dimColor>{kuerzen(`  „${s.auftrag}“`, breite)}</Text>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}

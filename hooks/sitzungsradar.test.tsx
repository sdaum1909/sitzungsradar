import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Herzschlag } from '../types'
import {
  abschnittVon,
  dauer,
  ersterSatz,
  kopfVon,
  lageVon,
  ordnen,
  projektVon,
  protokollAuswerten,
  schrittVon,
  spurWeiter,
  type Spur,
} from './register'

const JETZT = 1_800_000_000_000
const ORDNER = '/h/.claude/sitzungsradar'

const PANE = {
  plugin: 'sitzungsradar',
  component: 'Pane',
  requestId: 'sitzungsradar',
  props: {
    title: 'Sitzungsradar',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const schlag = (teil: Partial<Herzschlag> & { id: string; projekt: string }): Herzschlag => ({
  v: 1,
  ordner: `/h/${teil.projekt}`,
  status: 'wartet',
  statusSeit: JETZT - 60_000,
  zuletzt: JETZT - 5_000,
  ...teil,
})

const PROTOKOLL = '/h/.claude/projects/website/eigen.jsonl'

/** Ein Ordner im Speicher, und die Antworten, die sonst die Sitzung gibt. */
const welt = (
  on: On,
  dateien: Record<string, { text: string; mtimeMs: number }>,
  env: Record<string, string> = {},
) => {
  const geloescht: string[] = []
  const geoeffnet: string[][] = []
  mock.clock(on, { now: JETZT })
  mock.env(on, { HOME: '/h', ...env })
  on('session.info', () => ({ value: { transcriptPath: PROTOKOLL, platform: 'macos' as const } }))
  on('fs.stat', (_, e) => {
    const d = dateien[e.path]
    if (!d) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file' as const, size: d.text.length, mtimeMs: d.mtimeMs, isLink: false } }
  })
  on('command.register', () => ({ value: { command: 'sitzungsradar' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'eigen' }))
  on('session.cwd', () => ({ value: '/h/code/website/.claude/worktrees/radar-test' }))
  on('session.repo', () => ({ value: null }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surface', () => ({ value: 'desktop' }))
  on('fs.write', (_, e) => {
    dateien[e.path] = { text: e.text, mtimeMs: JETZT }
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const d = dateien[e.path]
    if (!d) throw new Error(`ENOENT ${e.path}`)
    // Testdaten sind ASCII: Zeichen und Bytes zählen gleich.
    const ab = e.offset ?? 0
    return { value: d.text.slice(ab, e.length === undefined ? undefined : ab + e.length) }
  })
  on('fs.list', (_, e) => ({
    value: Object.entries(dateien)
      .filter(([p]) => p.startsWith(`${e.path}/`))
      .map(([p, d]) => ({
        name: p.slice(e.path.length + 1),
        kind: 'file' as const,
        size: d.text.length,
        mtimeMs: d.mtimeMs,
        isLink: false,
      })),
  }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'open') geoeffnet.push([...e.argv])
    else geloescht.push(...e.argv.slice(2))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { dateien, geloescht, geoeffnet }
}

const datei = (h: Herzschlag, mtimeMs = h.zuletzt) => ({ text: JSON.stringify(h), mtimeMs })

/** Zeilen, wie sie im Protokoll einer Sitzung stehen (JSONL). */
const aufruf = (id: string, name: string, input: Record<string, unknown>) =>
  JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input }] },
  })
const KAPITEL = 'mcp__ccd_session__mark_chapter'
const PLAN = 'mcp__ccd_turn__update_plan'
const ABSCHLUSS = 'mcp__ccd_turn__wrap_up'
const titelZeile = (t: string) => JSON.stringify({ type: 'custom-title', customTitle: t, sessionId: 'eigen' })

// Der Testlauf hat einen Zeitgeber; die Typen des Mods kennen ihn nicht.
declare const setTimeout: (fn: () => void, ms: number) => unknown

/** Wartet, bis die Arbeit im Hintergrund fertig ist (sie startet ohne await). */
const bis = async (fertig: () => boolean) => {
  for (let i = 0; i < 200 && !fertig(); i++) await new Promise<void>(r => setTimeout(() => r(), 1))
}
const eigenVon = (dateien: Record<string, { text: string }>) =>
  JSON.parse(dateien[`${ORDNER}/eigen.json`]?.text ?? '{}') as Herzschlag

test('das Panel zeigt fremde Sitzungen und die eigene, auf jeder Oberfläche', async ($, on) => {
  const { dateien, geloescht } = welt(on, {
    [`${ORDNER}/a.json`]: datei(
      schlag({
        id: 'a',
        projekt: 'shop-relaunch',
        status: 'arbeitet',
        statusSeit: JETZT - 125_000,
        werkzeug: { name: 'Bash', seit: JETZT - 5_000, anzahl: 1 },
        auftrag: 'Baue die Anmeldeseite',
      }),
    ),
    [`${ORDNER}/b.json`]: datei(schlag({ id: 'b', projekt: 'rechnungs-app', statusSeit: JETZT - 120_000 })),
    [`${ORDNER}/c.json`]: datei(schlag({ id: 'c', projekt: 'Beendet', status: 'beendet' })),
    [`${ORDNER}/d.json`]: datei(schlag({ id: 'd', projekt: 'Still', zuletzt: JETZT - 600_000 }), JETZT - 600_000),
  })

  await $.session.start({ cwd: '/h/code/website', surface: 'desktop', isInteractive: true })

  const eigen = JSON.parse(dateien[`${ORDNER}/eigen.json`]?.text ?? '{}') as Herzschlag
  expect(eigen.projekt).toBe('website')
  expect(eigen.zweig).toBe('radar-test')
  expect(eigen.status).toBe('wartet')
  expect(geloescht).toEqual([`${ORDNER}/c.json`])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /Sitzungen/ }))?.text).toBe(
      '3 Sitzungen · 2 warten · 1 arbeitet',
    )
    expect((await ui.find({ type: 'Text', text: /shop-relaunch/ }))?.text).toBe('● shop-relaunch')
    expect((await ui.find({ type: 'Text', text: /arbeitet seit/ }))?.text).toBe(
      '  arbeitet seit 2 min · Bash',
    )
    expect((await ui.find({ type: 'Text', text: /Anmeldeseite/ }))?.text).toBe('  „Baue die Anmeldeseite“')
    expect((await ui.find({ type: 'Text', text: /rechnungs-app/ }))?.text).toBe('○ rechnungs-app')
    expect((await ui.find({ type: 'Text', text: /radar-test/ }))?.text).toBe(
      '○ website › radar-test  (diese Sitzung)',
    )
    expect(Boolean(await ui.find({ type: 'Text', text: /Still|Beendet/ }))).toBe(false)
    await ui.unmount()
  }
})

test('ein laufendes Werkzeug steht im eigenen Herzschlag, bis es fertig ist', async ($, on) => {
  const { dateien } = welt(on, {})
  let waehrend: Herzschlag | undefined
  on('tool.call', () => {
    waehrend = JSON.parse(dateien[`${ORDNER}/eigen.json`]?.text ?? '{}') as Herzschlag
    return { result: {} }
  })

  await $.session.start({ cwd: '/h/code/website', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(waehrend?.werkzeug?.name).toBe('Bash')
  const danach = JSON.parse(dateien[`${ORDNER}/eigen.json`]?.text ?? '{}') as Herzschlag
  expect(danach.werkzeug).toBe(undefined)
})

test('ohne Auftrag in den Einstellungen bleibt die Eingabe verborgen', { options: { zeige_auftrag: false } }, async ($, on) => {
  welt(on, {
    [`${ORDNER}/a.json`]: datei(schlag({ id: 'a', projekt: 'shop-relaunch', auftrag: 'Geheimer Auftrag' })),
  })
  await $.session.start({ cwd: '/h/code/website', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /shop-relaunch/ }))?.text).toBe('○ shop-relaunch')
  expect(Boolean(await ui.find({ type: 'Text', text: /Geheimer/ }))).toBe(false)
  await ui.unmount()
})

test('Projektname, Dauer und Lage', () => {
  expect(projektVon('/u/x/website/.claude/worktrees/abc')).toEqual({ projekt: 'website', zweig: 'abc' })
  expect(projektVon('/u/x/shop-relaunch/src', '/u/x/shop-relaunch')).toEqual({ projekt: 'shop-relaunch' })
  expect(dauer(42_000)).toBe('42 s')
  expect(dauer(3_720_000)).toBe('1 h 2 min')

  const h = schlag({ id: 'x', projekt: 'P', status: 'arbeitet', statusSeit: JETZT - 1_000 })
  expect(lageVon({ ...h, werkzeug: { name: 'AskUserQuestion', seit: JETZT, anzahl: 1 } }, JETZT, 900_000)).toBe('frage')
  expect(lageVon({ ...h, werkzeug: { name: 'Bash', seit: JETZT - 90_000, anzahl: 1 } }, JETZT, 900_000)).toBe('freigabe')
  expect(lageVon({ ...h, status: 'wartet', statusSeit: JETZT - 1_000_000 }, JETZT, 900_000)).toBe('ruhig')

  const zeilen = ordnen(
    [
      schlag({ id: '1', projekt: 'B', status: 'arbeitet' }),
      { ...h, id: '2', werkzeug: { name: 'AskUserQuestion', seit: JETZT, anzahl: 1 } },
      schlag({ id: '3', projekt: 'A' }),
    ],
    JETZT,
    900_000,
  )
  expect(zeilen.map(z => z.h.id)).toEqual(['2', '3', '1'])
  expect(kopfVon(zeilen)).toBe('3 Sitzungen · 1 braucht dich · 1 wartet · 1 arbeitet')
})

test('fremde Sitzung: Titel vorn, Herkunft dahinter, Abschnitt, und ein Knopf hinein', async ($, on) => {
  const { geoeffnet } = welt(
    on,
    {
      [`${ORDNER}/a.json`]: datei(
        schlag({
          id: 'a',
          projekt: 'shop-relaunch',
          zweig: 'login',
          titel: 'Anmeldeseite bauen',
          abschnitt: 'Formular',
          schritt: { text: 'Tests schreiben', nr: 2, von: 5 },
          hostId: 'local_abc-123',
        }),
      ),
      [`${ORDNER}/b.json`]: datei(schlag({ id: 'b', projekt: 'rechnungs-app' })),
      [`${ORDNER}/c.json`]: datei(schlag({ id: 'c', projekt: 'notizen', hostId: 'local_../../x' })),
    },
    { CLAUDE_CODE_HOST_SESSION_ID: 'local_eigen-1' },
  )
  await $.session.start({ cwd: '/h/code/website', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Anmeldeseite/ }))?.text).toBe('○ Anmeldeseite bauen')
    expect((await ui.find({ type: 'Text', text: /shop-relaunch/ }))?.text).toBe(
      '  wartet auf dich seit 1 min · shop-relaunch › login',
    )
    expect((await ui.find({ type: 'Text', text: /Abschnitt/ }))?.text).toBe(
      '  Abschnitt: Formular · Schritt 2/5: Tests schreiben',
    )
    expect(Boolean(await ui.find({ key: 'oeffnen-a' }))).toBe(true)
    // Ohne gültige Kennung und für die eigene Sitzung gibt es keinen Knopf.
    expect(Boolean(await ui.find({ key: 'oeffnen-b' }))).toBe(false)
    expect(Boolean(await ui.find({ key: 'oeffnen-c' }))).toBe(false)
    expect(Boolean(await ui.find({ key: 'oeffnen-eigen' }))).toBe(false)
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'oeffnen-a' })
  await bis(() => geoeffnet.length > 0)
  expect(geoeffnet).toEqual([['open', 'claude://code/continue?session=local_abc-123']])
  await ui.unmount()

  const r = await $.command.run({
    command: 'sitzungsradar',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 200 },
  })
  expect(r.text).toContain('Anmeldeseite bauen: wartet auf dich seit 1 min')
  expect(r.text).toContain('   Öffnen: claude://code/continue?session=local_abc-123')
})

test('die eigene Sitzung liest Titel, Kapitel und Schritt aus ihrem Protokoll, ohne doppelt zu zählen', async ($, on) => {
  const plan = {
    items: [
      { content: 'Code sichten', status: 'completed' },
      { content: 'Tests schreiben', status: 'in_progress' },
      { content: 'Veröffentlichen', status: 'pending' },
    ],
  }
  // Jeder Aufruf steht zweimal im Protokoll; der Titel ist JSON-maskiert.
  const zeilen = [
    titelZeile('alt'),
    aufruf('toolu_1', KAPITEL, { title: 'Erkundung' }),
    aufruf('toolu_1', KAPITEL, { title: 'Erkundung' }),
    aufruf('toolu_2', PLAN, plan),
    aufruf('toolu_2', PLAN, plan),
    titelZeile('Radar "Abschnitte" bauen'),
    aufruf('toolu_3', KAPITEL, { title: 'Umsetzung' }),
  ]
  const { dateien } = welt(
    on,
    { [PROTOKOLL]: { text: `${zeilen.join('\n')}\n`, mtimeMs: JETZT } },
    { CLAUDE_CODE_HOST_SESSION_ID: 'local_eigen-1' },
  )
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/h/code/website', surface: 'desktop', isInteractive: true })
  await bis(() => eigenVon(dateien).abschnitt === 'Umsetzung')
  let eigen = eigenVon(dateien)
  expect(eigen.titel).toBe('Radar "Abschnitte" bauen')
  expect(eigen.abschnitt).toBe('Umsetzung')
  expect(eigen.schritt).toEqual({ text: 'Tests schreiben', nr: 2, von: 3 })
  expect(eigen.hostId).toBe('local_eigen-1')

  // Live aus dem Werkzeugaufruf, bevor das Protokoll ihn kennt.
  await $.tool.call({ tool: PLAN, advance: true, tool_use_id: 'toolu_4' } as never)
  expect(eigenVon(dateien).schritt).toEqual({ text: 'Veröffentlichen', nr: 3, von: 3 })

  // Danach steht derselbe Aufruf zweimal im Protokoll: er zählt nicht noch einmal.
  const neu = [aufruf('toolu_4', PLAN, { advance: true }), aufruf('toolu_4', PLAN, { advance: true })]
  const p = dateien[PROTOKOLL]
  if (p) p.text += `${neu.join('\n')}\n`
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await bis(() => false)
  eigen = eigenVon(dateien)
  expect(eigen.schritt).toEqual({ text: 'Veröffentlichen', nr: 3, von: 3 })

  await $.tool.call({
    tool: ABSCHLUSS,
    recap: 'Die Seite ist veröffentlicht. Nichts committet.',
    tool_use_id: 'toolu_5',
  } as never)
  eigen = eigenVon(dateien)
  expect(eigen.schritt).toEqual({ text: '', nr: 3, von: 3, fertig: true })
  expect(eigen.stand).toBe('Die Seite ist veröffentlicht.')
})

test('Aufgabenliste, Schritt und Abschnittszeilen', () => {
  let s: Spur = {}
  s = spurWeiter(s, PLAN, {
    items: [
      { content: 'Eins', status: 'in_progress' },
      { content: 'Zwei', status: 'pending' },
      { content: 'Drei', status: 'pending' },
    ],
  })
  expect(schrittVon(s.plan)).toEqual({ text: 'Eins', nr: 1, von: 3 })
  s = spurWeiter(s, PLAN, { advance: true })
  expect(schrittVon(s.plan)).toEqual({ text: 'Zwei', nr: 2, von: 3 })
  s = spurWeiter(s, PLAN, { done: [2], start: 3 })
  expect(schrittVon(s.plan)).toEqual({ text: 'Drei', nr: 3, von: 3 })
  s = spurWeiter(s, PLAN, { start: 1 })
  expect(s.plan?.map(p => p.status)).toEqual(['in_progress', 'completed', 'pending'])
  s = spurWeiter(s, PLAN, { done: [9], start: 0 })
  expect(schrittVon(s.plan)).toEqual({ text: 'Eins', nr: 1, von: 3 })
  s = spurWeiter(s, ABSCHLUSS, {})
  expect(schrittVon(s.plan)).toEqual({ text: '', nr: 3, von: 3, fertig: true })
  expect(s.stand).toBe(undefined)
  s = spurWeiter(s, ABSCHLUSS, { recap: 'Version 1.2 ist live!  Offen: Doku.' })
  expect(s.stand).toBe('Version 1.2 ist live!')
  expect(spurWeiter(s, ABSCHLUSS, { recap: '' }).stand).toBe('Version 1.2 ist live!')
  expect(spurWeiter({}, ABSCHLUSS, { recap: 'Nur Stand.' })).toEqual({ stand: 'Nur Stand.' })
  expect(ersterSatz('Stand 1.2.3 ist da. Rest')).toBe('Stand 1.2.3 ist da.')
  expect(ersterSatz(42)).toBe('')
  s = spurWeiter(s, KAPITEL, { title: '  Tests\n und Prüfung ' })
  expect(s.abschnitt).toBe('Tests und Prüfung')
  expect(spurWeiter(s, KAPITEL, { title: '' }).abschnitt).toBe('Tests und Prüfung')
  expect(schrittVon([])).toBe(undefined)

  const f = protokollAuswerten(
    [titelZeile('Erst'), aufruf('t1', KAPITEL, { title: 'A {b} [c]' }), titelZeile('Dann'), '{"halb":'].join('\n') +
      aufruf('t2', PLAN, { items: [] }).slice(0, -12),
  )
  expect(f.titel).toBe('Dann')
  expect(f.aufrufe.map(a => [a.id, a.a.title])).toEqual([['t1', 'A {b} [c]']])

  const h = schlag({ id: 'x', projekt: 'P', abschnitt: 'Umsetzung', schritt: { text: 'Tests', nr: 2, von: 4 } })
  expect(abschnittVon(h, 60)).toEqual(['  Abschnitt: Umsetzung · Schritt 2/4: Tests'])
  expect(abschnittVon(h, 30)).toEqual(['  Abschnitt: Umsetzung', '  Schritt 2/4: Tests'])
  expect(abschnittVon({ ...h, abschnitt: undefined, schritt: { text: '', nr: 4, von: 4, fertig: true } }, 60)).toEqual([
    '  Plan erledigt (4/4)',
  ])
  expect(abschnittVon(schlag({ id: 'y', projekt: 'P' }), 60)).toEqual([])
  // Läuft kein Schritt, steht der Statussatz da; ein laufender Schritt geht ihm vor.
  const fertig = { ...h, schritt: { text: '', nr: 4, von: 4, fertig: true }, stand: 'Seite ist live.' }
  expect(abschnittVon(fertig, 60)).toEqual(['  Abschnitt: Umsetzung · Stand: Seite ist live.'])
  expect(abschnittVon({ ...h, stand: 'Seite ist live.' }, 60)).toEqual(['  Abschnitt: Umsetzung · Schritt 2/4: Tests'])
  expect(abschnittVon(schlag({ id: 'z', projekt: 'P', stand: 'Nur Stand.' }), 60)).toEqual(['  Stand: Nur Stand.'])
})

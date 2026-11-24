import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Herzschlag } from '../types'
import { dauer, kopfVon, lageVon, ordnen, projektVon } from './register'

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

/** Ein Ordner im Speicher, und die Antworten, die sonst die Sitzung gibt. */
const welt = (on: On, dateien: Record<string, { text: string; mtimeMs: number }>) => {
  const geloescht: string[] = []
  mock.clock(on, { now: JETZT })
  mock.env(on, { HOME: '/h' })
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
    return { value: d.text }
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
    geloescht.push(...e.argv.slice(2))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { dateien, geloescht }
}

const datei = (h: Herzschlag, mtimeMs = h.zuletzt) => ({ text: JSON.stringify(h), mtimeMs })

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

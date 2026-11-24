/** Was eine Sitzung über sich in ihre Herzschlag-Datei schreibt. */
export type Herzschlag = {
  v: 1
  id: string
  /** Projektname: Ordnername des Repos (bei einem Worktree das Haupt-Repo). */
  projekt: string
  /** Name des Worktrees, wenn die Sitzung in einem läuft. */
  zweig?: string
  /** Arbeitsordner der Sitzung. */
  ordner: string
  modell?: string
  status: 'arbeitet' | 'wartet' | 'beendet'
  /** Seit wann der Status gilt (ms seit 1970). */
  statusSeit: number
  /** Letzter Herzschlag (ms seit 1970). */
  zuletzt: number
  /** Das älteste gerade laufende Werkzeug, und wie viele laufen. */
  werkzeug?: { name: string; seit: number; anzahl: number }
  /** Anfang der letzten Eingabe. */
  auftrag?: string
  oberflaeche?: string
}

/** Was das Panel zeichnet. */
export type Radar = {
  liste: Herzschlag[]
  /** Wann der Ordner zuletzt gelesen wurde; Bezugspunkt für „seit“. */
  gelesen: number
  eigeneId?: string
  ruhigAbMs?: number
  zeigeAuftrag?: boolean
  fehler?: string
}

declare module 'claude-code' {
  interface PluginState {
    sitzungsradar: { radar: Shaped<Radar> }
  }
}

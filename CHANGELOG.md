# Änderungen

Alle nennenswerten Änderungen am Sitzungsradar. Die Versionsnummern folgen
[Semantic Versioning](https://semver.org/lang/de/); die Fassung im Manifest
(`.claude-plugin/plugin.json`) und der Git-Tag stimmen immer überein.

## [0.2.3] – 2026-11-28

### Behoben
- Das Aufräumen löscht nur noch eigene Herzschlag-Dateien: Der Dateiname passt zur Kennung im Inhalt,
  die Datei ist lesbar und höchstens 64 KB groß. Bisher löschte es jede `.json`-Datei im Ordner, die
  älter als 24 Stunden war. Zeigte die Einstellung `ordner` auf einen gemeinsam genutzten Ordner,
  traf das auch fremde Dateien.
- Alte Dateien liest das Radar nur noch beim Aufräumen, also höchstens einmal je Minute.

### Dokumentation
- SECURITY.md und README nennen jetzt beide Programme, die das Radar startet (`rm`, `open` bzw.
  `rundll32`), und die Umgebungsvariablen, die es liest (`HOME`, `CLAUDE_CODE_HOST_SESSION_ID`).
- Die Einstellung `ordner` rät zu einem eigenen, leeren Ordner.

## [0.2.2] – 2026-11-28

### Behoben
- Download-Weg: Die Anleitung zu 0.2.1 sagte, der entpackte Ordner dürfe nach der Installation weg.
  Claude Code lädt das Plugin aber bei jedem Start aus diesem Ordner; ohne ihn meldet es „failed to load“.
  Jetzt steht in der Anleitung: an einen festen Platz entpacken und den Ordner stehen lassen.
- Das Archiv entpackt in einen Ordner `sitzungsradar` ohne Versionsnummer. So geht ein Update an
  denselben Platz, und `claude plugin update` übernimmt es.

Am Code des Plugins hat sich nichts geändert.

## [0.2.1] – 2026-11-24

### Geändert
- Läuft kein Schritt der Aufgabenliste, zeigt das Radar den Stand der Sitzung: den ersten Satz der
  letzten Zusammenfassung, den die Desktop-App als Status in ihrer Seitenleiste führt. Bisher stand
  dort nur „Plan erledigt“. Die meisten Sitzungen setzen keine Kapitel, darum ist diese Zeile die häufigste.

### Dokumentation
- Am 28.11.2026 erstes Release zum Herunterladen: `sitzungsradar.zip` mit Prüfsumme in `SHA256SUMS.txt`.
- README mit Download-Weg, Einstellen per Befehl, Aktualisieren und Entfernen; dazu `SECURITY.md`
  und Vorlagen für Issues. Am Code des Plugins hat sich gegenüber dem 24.11. nichts geändert.

## [0.2.0] – 2026-11-24

### Neu
- Jede Sitzung steht mit ihrem Namen da, so wie er in der Seitenleiste der Desktop-App steht
  (oder per `/rename` gesetzt ist), dahinter Projekt und Zweig.
- Zeile „Abschnitt: … · Schritt n/m: …“ mit dem laufenden Kapitel und dem Schritt der Aufgabenliste.
  Die Sitzung liest beides aus ihrem eigenen Protokoll, nur neue Zeilen.
- Knopf „Öffnen“: springt in die Sitzung der Desktop-App. `/sitzungsradar` druckt den Link mit.

## [0.1.0] – 2026-11-24

### Neu
- Panel mit allen laufenden Claude-Code-Sitzungen über alle Projekte: wer arbeitet (●), wer auf dich
  wartet (○), wer dich braucht (◆) und wer ruhig ist (·).
- Jede Sitzung schreibt einen Herzschlag nach `~/.claude/sitzungsradar/`, jedes Panel liest den Ordner
  alle fünf Sekunden. Alles lokal, kein Netz, kein Modellaufruf.
- Kurzzeile in der Statusleiste und Befehl `/sitzungsradar`.
- Vier Einstellungen: letzten Auftrag zeigen, ruhig ab (Minuten), Panel beim Start öffnen, Ordner.

[0.2.3]: https://github.com/sdaum1909/sitzungsradar/releases/tag/v0.2.3
[0.2.2]: https://github.com/sdaum1909/sitzungsradar/releases/tag/v0.2.2
[0.2.1]: https://github.com/sdaum1909/sitzungsradar/releases/tag/v0.2.1
[0.2.0]: https://github.com/sdaum1909/sitzungsradar/commit/a7e903f
[0.1.0]: https://github.com/sdaum1909/sitzungsradar/commit/f843fe0

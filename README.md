# Sitzungsradar

Ein Panel für Claude Code, das dir alle gerade laufenden Sitzungen zeigt, über alle Projekte hinweg.
Wer mit Claude anfängt, hat schnell drei, vier Sitzungen offen und verliert den Überblick: Welche
arbeitet noch? Welche wartet seit zehn Minuten auf mich? Wo hängt eine Freigabe? Das Sitzungsradar
beantwortet das auf einen Blick, im Terminal und in der Desktop-App.

Ein Werkzeug von [BuildMySoftware](https://buildmysoftware.de).

## Was du siehst

```
Sitzungsradar
4 Sitzungen · 1 braucht dich · 2 warten · 1 arbeitet

◆ shop-relaunch
  fragt dich (AskUserQuestion)
● rechnungs-app › neue-maske
  arbeitet seit 3 min · Bash
  „Bau mir die Eingabemaske für Rechnungen“
○ website › blog  (diese Sitzung)
  wartet auf dich seit 2 min
· Notizen
  ruhig seit 40 min
```

| Zeichen | Bedeutung |
|---|---|
| ◆ | Die Sitzung braucht dich: eine Frage an dich, oder ein Werkzeug läuft seit über einer Minute (meist eine offene Freigabe) |
| ● | Claude arbeitet, mit dem Werkzeug, das gerade läuft |
| ○ | Fertig, wartet auf deine nächste Eingabe |
| · | Wartet schon lange (blass) |

Oben steht die Zusammenfassung, dazu kommt eine kurze Zeile in der Statusleiste („Radar 4 · 1 braucht dich“).
Wer dich braucht, steht immer oben.

## So funktioniert es

Jede Sitzung, in der das Sitzungsradar läuft, schreibt alle 20 Sekunden und bei jedem Wechsel
(Auftrag gestartet, Werkzeug läuft, fertig) eine kleine Datei nach `~/.claude/sitzungsradar/`.
Jedes Panel liest diesen Ordner alle 5 Sekunden. Beendete Sitzungen verschwinden sofort,
abgestürzte nach drei Minuten Stille. Alte Dateien räumt das Radar selbst weg.

Darum siehst du nur Sitzungen, in denen das Sitzungsradar installiert ist. Am einfachsten installierst
du es einmal für deinen Benutzer, dann ist es in jeder Sitzung dabei.

## Installieren

In einer Terminal-Sitzung von Claude Code, an der Eingabe:

```
/plugin install sitzungsradar --marketplace sdaum1909/sitzungsradar
```

Aus einer Shell:

```bash
claude plugin install sitzungsradar --marketplace sdaum1909/sitzungsradar
```

In der Claude-Desktop-App: neben dem Eingabefeld auf **+** → **Plugins** → **Marketplace hinzufügen**
mit `sdaum1909/sitzungsradar` → **Plugin hinzufügen**.

Danach öffnet sich das Panel in jeder neuen Sitzung von selbst, wenn Platz ist.
Sonst holst du es mit `/sitzungsradar`.

Meldet die Installation „4 userConfig options not yet set“, kannst du das übergehen:
jede Einstellung hat einen Standardwert. Ändern kannst du sie jederzeit (siehe unten).

## Einstellungen

| Einstellung | Standard | Wirkung |
|---|---|---|
| Letzten Auftrag zeigen | an | Zeigt unter jeder Sitzung den Anfang deiner letzten Eingabe |
| Ruhig ab (Minuten) | 15 | Ab wann eine wartende Sitzung blass gezeigt wird |
| Panel beim Start öffnen | an | Öffnet das Panel in jeder neuen Sitzung |
| Ordner für die Herzschläge | leer | Leer heißt `~/.claude/sitzungsradar`; alle Sitzungen müssen denselben Ordner nutzen |

## Datenschutz

Alles bleibt auf deinem Rechner. Das Sitzungsradar sendet nichts ins Netz und ruft kein Modell auf.
In den Dateien stehen Projektname, Ordner, Modell, Zustand, das laufende Werkzeug und, wenn du es
nicht abschaltest, die ersten 140 Zeichen deiner letzten Eingabe. Schalte „Letzten Auftrag zeigen“
aus, wenn du das nicht willst; dann schreibt das Radar die Eingabe auch nicht mehr in die Datei.

## Grenzen

- Eine offene Freigabe meldet Claude Code nicht eigens. Das Radar schließt darauf, wenn ein Werkzeug
  länger als eine Minute läuft. Ein langer Testlauf zeigt darum ebenfalls ◆.
- Sitzungen ohne Sitzungsradar sieht das Panel nicht.

## Lizenz

MIT, siehe [LICENSE](LICENSE). © 1000deals.de GmbH · BuildMySoftware

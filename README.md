# Sitzungsradar

Ein Panel für Claude Code, das dir alle gerade laufenden Sitzungen zeigt, über alle Projekte hinweg.
Wer mit Claude anfängt, hat schnell drei, vier Sitzungen offen und verliert den Überblick: Welche
arbeitet noch? Welche wartet seit zehn Minuten auf mich? Wo hängt eine Freigabe? Das Sitzungsradar
beantwortet das auf einen Blick, im Terminal und in der Desktop-App. Jede Sitzung steht mit ihrem
Namen da, mit dem Abschnitt, in dem sie gerade arbeitet, und mit einem Knopf, der dich direkt hineinbringt.

Ein Werkzeug von [BuildMySoftware](https://buildmysoftware.de).

## Was du siehst

```
Sitzungsradar
4 Sitzungen · 1 braucht dich · 2 warten · 1 arbeitet

◆ Anmeldeseite bauen                              [ Öffnen ]
  fragt dich (AskUserQuestion) · shop-relaunch › login · opus-5-5
  Abschnitt: Formular · Schritt 2/5: Tests schreiben

● Rechnungsmaske                                  [ Öffnen ]
  arbeitet seit 3 min · Bash · rechnungs-app › neue-maske · sonnet-5-5
  Abschnitt: Umsetzung · Schritt 3/4: Eingabefelder prüfen
  „Bau mir die Eingabemaske für Rechnungen“

○ Blog-Layout  (diese Sitzung)
  wartet auf dich seit 2 min · website › blog · opus-5-5
  Plan erledigt (5/5)

· notizen
  ruhig seit 40 min · haiku-5-5
```

Jeder Eintrag zeigt:

- **den Namen der Sitzung**, so wie er in der Seitenleiste der Desktop-App steht (oder wie du ihn mit
  `/rename` gesetzt hast); dahinter Projekt › Zweig, damit du auch gleich benannte Sitzungen auseinanderhältst.
  Hat eine Sitzung noch keinen Namen, steht dort Projekt › Zweig.
- **den Abschnitt**: das Kapitel, in dem Claude gerade arbeitet, und den laufenden Schritt der Aufgabenliste
  („Schritt 2/5: Tests schreiben“). Ist die Liste abgehakt, steht dort „Plan erledigt“.
- **den Knopf „Öffnen“**: ein Druck, und die Desktop-App springt in diese Sitzung, damit du dort
  weitermachst. Braucht die Sitzung dich, ist der Knopf hervorgehoben.

| Zeichen | Bedeutung |
|---|---|
| ◆ | Die Sitzung braucht dich: eine Frage an dich, oder ein Werkzeug läuft seit über einer Minute (meist eine offene Freigabe) |
| ● | Claude arbeitet, mit dem Werkzeug, das gerade läuft |
| ○ | Fertig, wartet auf deine nächste Eingabe |
| · | Wartet schon lange (blass) |

Oben steht die Zusammenfassung, dazu kommt eine kurze Zeile in der Statusleiste („Radar 4 · 1 braucht dich“).
Wer dich braucht, steht immer oben. `/sitzungsradar` schreibt dieselbe Übersicht in den Chat, mit dem Link
zum Öffnen unter jeder Sitzung.

## So funktioniert es

Jede Sitzung, in der das Sitzungsradar läuft, schreibt alle 20 Sekunden und bei jedem Wechsel
(Auftrag gestartet, Werkzeug läuft, fertig) eine kleine Datei nach `~/.claude/sitzungsradar/`.
Jedes Panel liest diesen Ordner alle 5 Sekunden. Beendete Sitzungen verschwinden sofort,
abgestürzte nach drei Minuten Stille. Alte Dateien räumt das Radar selbst weg.

Name, Kapitel und Schritt liest jede Sitzung aus ihrem eigenen Protokoll, beim Start einmal von hinten
und danach nur die neuen Zeilen. Wechselt sie das Kapitel oder hakt einen Schritt ab, steht das sofort
in ihrer Datei.

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
In den Dateien stehen Projektname, Ordner, Modell, Zustand, das laufende Werkzeug, der Name der Sitzung,
ihr Kapitel und Schritt (je höchstens 80 Zeichen), die Kennung für den Sprung und, wenn du es
nicht abschaltest, die ersten 140 Zeichen deiner letzten Eingabe. Schalte „Letzten Auftrag zeigen“
aus, wenn du das nicht willst; dann schreibt das Radar die Eingabe auch nicht mehr in die Datei.
Für Name, Kapitel und Schritt liest jede Sitzung ihr eigenes Protokoll auf deinem Rechner und übernimmt
daraus nur diese drei Angaben.

## Grenzen

- Eine offene Freigabe meldet Claude Code nicht eigens. Das Radar schließt darauf, wenn ein Werkzeug
  länger als eine Minute läuft. Ein langer Testlauf zeigt darum ebenfalls ◆.
- Sitzungen ohne Sitzungsradar sieht das Panel nicht.
- Der Knopf „Öffnen“ springt nur in Sitzungen der Claude-Desktop-App. Geprüft auf macOS; unter Windows
  ist der Weg eingebaut, aber noch nicht getestet.
- Kapitel und Aufgabenliste führt die Desktop-App. In einer Terminal-Sitzung siehst du Projekt und Zustand,
  einen Namen erst nach `/rename`.

## Lizenz

MIT, siehe [LICENSE](LICENSE). © 1000deals.de GmbH · BuildMySoftware

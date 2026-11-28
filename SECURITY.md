# Sicherheit

## Unterstützte Versionen

Sicherheitskorrekturen gibt es für die jeweils neueste Version. Wer eine ältere nutzt, aktualisiert
mit `claude plugin update sitzungsradar@sitzungsradar`.

## Eine Lücke melden

Bitte melde Sicherheitslücken **nicht** in einem öffentlichen Issue, sondern vertraulich über GitHub:
Reiter **Security** in diesem Repository → **Report a vulnerability**
([direkt](https://github.com/sdaum1909/sitzungsradar/security/advisories/new)).

Hilfreich sind:

- die Version des Sitzungsradars und von Claude Code (`claude --version`),
- dein System (macOS, Windows, Linux) und ob Terminal oder Desktop-App,
- was du beobachtet hast und wie es sich nachstellen lässt.

Wir bestätigen den Eingang innerhalb von fünf Werktagen und sagen dir, wie es weitergeht. Ist die Lücke
bestätigt, veröffentlichen wir eine korrigierte Version und nennen dich auf Wunsch in den Release Notes.

## Was das Plugin darf

Damit du einschätzen kannst, was eine Lücke bedeuten würde:

- **Kein Netz.** Das Manifest gibt keinen Netzwerk-Host frei (`"network": { "hosts": [] }`).
- **Kein Modellaufruf.** Das Radar ruft kein Modell auf und startet keine Agenten.
- **Dateien:** Es schreibt und liest nur seinen Ordner (Standard `~/.claude/sitzungsradar/`) und liest
  das Protokoll der eigenen Sitzung, um Name, Kapitel, Schritt und Stand zu übernehmen.
- **Sprung:** Der Knopf „Öffnen“ ruft einen Link der Form `claude://code/continue?session=<Kennung>` auf.

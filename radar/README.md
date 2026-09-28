# Markt-Radar

490 Unternehmen an sieben Börsen: USA, Europa, Japan, Korea, Australien, Mexiko und Brasilien.
Pro Markt die 50 größten Unternehmen und 20 kleinere Wachstumswerte. Jedes Unternehmen hat eine
Beschreibung. Die wirtschaftliche Lage wird live aus Kursdaten berechnet.

Läuft als privates claude.ai-Artifact mit der Capability `mcp` (Server „Interactive Brokers“,
Tools `search_contracts`, `get_price_snapshot`, `get_price_history`). Die Zugangsdaten verlassen
claude.ai nie.

## Aufbau

- `src/companies.js`: Märkte, Handelszeiten, Unternehmen (Ticker, Name, Branche, Beschreibung, Land, Such-Aliase)
- `src/app.html`: Oberfläche und Logik
- `src/build.py`: fügt beides zu `markt-radar.html` zusammen (eine Datei, die veröffentlicht wird)

## Datenwege (getestet mit dem IBKR-Konto, September 2026)

| Markt | Weg | Status |
|---|---|---|
| USA | SMART | Echtzeit |
| Europa, Japan | SMART | verzögert |
| Brasilien (B3), Mexiko (MEXI) | Heimatbörse, SMART wird abgelehnt | verzögert |
| Korea, Australien | SMART | verzögert, außerhalb der Handelszeit Schlusskurs ohne Veränderung |

Die App probiert zuerst SMART und dann die Heimatbörse. Den Weg, der funktioniert, merkt sie sich pro Aktie.
Fehlt die Veränderung, berechnet sie diese aus den letzten Tagesschlusskursen.
LSE-Kurse kommen in Pence (GBp).

## Aktualisierung

Bei offener Börse gilt pro Kurs ein Höchstalter:

| Was | Höchstalter |
|---|---|
| geöffnetes Unternehmen (Detailansicht) | 10 s |
| sichtbare Karten | 15 s |
| übriger sichtbarer Markt | 60 s |
| andere Märkte (Börsenleiste) | 5 min |
| geschlossene Börse | 20 min |

Die Schleife prüft alle 5 s. Antwortet IBKR langsam, verlängern sich alle Intervalle bis Faktor 4 und erholen sich bei Erfolg wieder.
Jede Karte zeigt das Alter ihres Kurses und „veraltet“, wenn es das Doppelte des Höchstalters überschreitet.
Es laufen maximal 4 Abrufe parallel, davon 1 für den Hintergrund. Ohne IBKR-Freigabe stoppt die Schleife. Ist der Tab verborgen, ruht sie.

Grenze: „Aktuell“ heißt aktuell abgerufen. Ob ein Kurs Echtzeit oder ca. 15 Min. verzögert ist, bestimmt das Marktdaten-Abo im IBKR-Konto.

## Warum grün, warum rot?

Jede Karte zeigt einen Grund in einer Zeile. Die Detailansicht erklärt ihn ausführlich. Alles beruht auf Börsenkursen von IBKR:

- **Definition:** Grün oder Rot hängt davon ab, ob der Kurs über oder unter dem offiziellen Schlusskurs des Vortags liegt. Angegeben mit beiden Kursen und der Differenz.
- **Markt und Branche:** wie viele Werte im selben Markt steigen, dazu der Durchschnitt der Branche.
- **Einordnung:**
  - mit dem Markt
  - Branche stark oder schwach
  - gegen den Markt
  - deutlich stärker oder schwächer als der Markt, was auf einen unternehmensspezifischen Auslöser hindeutet
- **Umsatz (nur USA):** Vielfaches des 90-Tage-Durchschnitts.
- **Richtungswechsel:**
  - aus den 5-Minuten-Kerzen des Tages, mit Zeitfenster und Kurs
  - von der App beobachtet, samt Markt- und Branchenlage im Moment des Wechsels

Nachrichten sind nicht angebunden. Die konkrete Meldung hinter einer Bewegung nennt die App deshalb nicht.
Kostenlose Quellen stehen pro Unternehmen als Links bereit: SEC Form 8-K (nur USA), Google News (deutsch und englisch) und die Yahoo-Finance-Seite mit Meldungen.

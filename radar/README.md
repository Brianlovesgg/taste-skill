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

Eine Warteschlange mit drei Prioritäten:
1. Detailansicht
2. sichtbarer Markt, alle 60 s bei offener Börse, sonst alle 20 min
3. übrige Märkte, alle 5 min bei offener Börse, sonst stündlich

Es laufen maximal 4 Abrufe gleichzeitig, davon höchstens 1 im Hintergrund. Ist IBKR überlastet, pausiert die Warteschlange.
Fehlt die Freigabe für IBKR, stoppt sie ganz. Ist der Tab verborgen, finden keine Abrufe statt.

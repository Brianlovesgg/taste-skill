# Markt-Radar (IBKR)

Watchlist mit Richtung (▲▼), Veränderung zum Vortag, Tagesspanne, Datenstatus und Kursverlauf.
Datenquelle ist das Interactive-Brokers-Konto des Nutzers über den claude.ai-Connector.

- Läuft als privates claude.ai-Artifact (Capability `mcp`, Server „Interactive Brokers“). Zugangsdaten verlassen claude.ai nie.
- Außerhalb von claude.ai (z. B. GitHub Pages) zeigt die Seite nur einen Hinweis. Deshalb liegt sie nicht in `terminal/`.
- Aktualisierung alle 30 s über `watchTool`, pausiert, solange der Tab verborgen ist.
- Rund 130 Werte in Gruppen: DAX & DE, Dow 30, Nasdaq Top 40, Indizes & Sektoren, Rohstoffe & Zinsen, eigene Watchlist.
- Symbole werden einmalig per `search_contracts` in IBKR-Contract-IDs aufgelöst und im Browser gespeichert.
- Deutsche Werte laufen über SMART-Routing: verzögerte Kurse ohne XETRA-Abo (direkt über IBIS: REJECT).
- Pro Runde (alle 45 s) nur die sichtbare Gruppe, 4 parallele Abrufe. Zusatzdaten (52W, YTD, Vola, Dividende, Ø-Umsatz) alle 15 min.

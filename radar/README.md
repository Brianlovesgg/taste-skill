# Markt-Radar (IBKR)

Watchlist mit Richtung (▲▼), Veränderung zum Vortag, Tagesspanne, Datenstatus und Kursverlauf.
Datenquelle ist das Interactive-Brokers-Konto des Nutzers über den claude.ai-Connector.

- Läuft als privates claude.ai-Artifact (Capability `mcp`, Server „Interactive Brokers“). Zugangsdaten verlassen claude.ai nie.
- Außerhalb von claude.ai (z. B. GitHub Pages) zeigt die Seite nur einen Hinweis. Deshalb liegt sie nicht in `terminal/`.
- Aktualisierung alle 30 s über `watchTool`, pausiert, solange der Tab verborgen ist.
- Datenstatus pro Wert: REALTIME, DELAYED, REJECT (Abo fehlt). XETRA-Werte brauchen ein IBKR-Marktdaten-Abo für Deutschland.

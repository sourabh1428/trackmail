CREATE TABLE IF NOT EXISTS tracking_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  email     TEXT    NOT NULL,
  event     TEXT    NOT NULL,   -- 'open' | 'click'
  bunch_id  TEXT    NOT NULL,
  url       TEXT,               -- only set for click events
  ip        TEXT,
  timestamp TEXT    NOT NULL    -- ISO-8601 UTC string
);

CREATE INDEX IF NOT EXISTS idx_te_bunch_id    ON tracking_events (bunch_id);
CREATE INDEX IF NOT EXISTS idx_te_email_event ON tracking_events (email, event);
